//
//  BiometricAuthHandler.swift
//  iosnativeWebView
//
//  Face ID / Touch ID authentication and biometric-protected Keychain storage.
//

import Foundation
import LocalAuthentication
import Security
import os

private let bioLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.app", category: "BiometricAuth")

enum BiometryTypeString: String {
    case none
    case face
    case touch
    case unknown
}

struct BiometricAvailability {
    let available: Bool
    let enrolled: Bool
    let biometryType: BiometryTypeString
    let errorMessage: String?
}

final class BiometricAuthHandler {

    static let shared = BiometricAuthHandler()

    private let keychainService = "\(Bundle.main.bundleIdentifier ?? "com.app").biometricCredentials"

    private init() {}

    // MARK: - Availability

    func availability() -> BiometricAvailability {
        let context = LAContext()
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)

        let type: BiometryTypeString
        switch context.biometryType {
        case .faceID:
            type = .face
        case .touchID:
            type = .touch
        case .none:
            type = .none
        @unknown default:
            type = .unknown
        }

        if canEvaluate {
            return BiometricAvailability(available: true, enrolled: true, biometryType: type, errorMessage: nil)
        }

        let laError = error as? LAError
        let enrolled = laError?.code != .biometryNotEnrolled
        return BiometricAvailability(
            available: type != .none && laError?.code != .biometryNotAvailable,
            enrolled: enrolled,
            biometryType: type,
            errorMessage: error?.localizedDescription
        )
    }

    // MARK: - Authenticate

    /// Result is delivered on the main queue.
    func authenticate(reason: String, fallbackTitle: String?, cancelTitle: String?,
                      completion: @escaping (Result<Void, BiometricError>) -> Void) {
        let context = LAContext()
        if let fallbackTitle { context.localizedFallbackTitle = fallbackTitle }
        if let cancelTitle { context.localizedCancelTitle = cancelTitle }

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            let err = BiometricError.from(laError: error as? LAError, fallback: error?.localizedDescription)
            DispatchQueue.main.async { completion(.failure(err)) }
            return
        }

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: reason) { success, evalError in
            DispatchQueue.main.async {
                if success {
                    completion(.success(()))
                } else {
                    let err = BiometricError.from(laError: evalError as? LAError,
                                                  fallback: evalError?.localizedDescription)
                    completion(.failure(err))
                }
            }
        }
    }

    // MARK: - Keychain credential storage

    /// Stores `value` under `key`, gated by current-biometry enrollment. Replaces existing entries.
    func setCredential(key: String, value: String) -> Result<Void, BiometricError> {
        guard !key.isEmpty else { return .failure(.invalidParams("key is required")) }
        guard let data = value.data(using: .utf8) else {
            return .failure(.invalidParams("value must be UTF-8 encodable"))
        }

        var accessControlError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &accessControlError
        ) else {
            let message = (accessControlError?.takeRetainedValue() as Error?)?.localizedDescription
                ?? "Failed to create access control"
            bioLogger.error("AccessControl creation failed: \(message, privacy: .public)")
            return .failure(.keychain(message))
        }

        // Delete any existing entry first so we don't hit duplicate-item errors.
        _ = deleteCredentialRaw(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessControl as String: access
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecSuccess {
            return .success(())
        }
        return .failure(.keychain("SecItemAdd failed: \(status)"))
    }

    /// Reads `key`. Triggers biometric prompt because of the access control we stored with.
    /// Result delivered on main queue.
    func getCredential(key: String, reason: String,
                       completion: @escaping (Result<String, BiometricError>) -> Void) {
        guard !key.isEmpty else {
            DispatchQueue.main.async { completion(.failure(.invalidParams("key is required"))) }
            return
        }

        let context = LAContext()
        context.localizedReason = reason

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context,
            kSecUseOperationPrompt as String: reason
        ]

        // SecItemCopyMatching can block on the biometric prompt — run off main.
        DispatchQueue.global(qos: .userInitiated).async {
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)

            DispatchQueue.main.async {
                switch status {
                case errSecSuccess:
                    if let data = item as? Data, let string = String(data: data, encoding: .utf8) {
                        completion(.success(string))
                    } else {
                        completion(.failure(.keychain("Stored value is not valid UTF-8")))
                    }
                case errSecItemNotFound:
                    completion(.failure(.notFound))
                case errSecUserCanceled, errSecAuthFailed:
                    completion(.failure(.userCancelled))
                default:
                    completion(.failure(.keychain("SecItemCopyMatching failed: \(status)")))
                }
            }
        }
    }

    func deleteCredential(key: String) -> Result<Void, BiometricError> {
        guard !key.isEmpty else { return .failure(.invalidParams("key is required")) }
        let status = deleteCredentialRaw(key: key)
        if status == errSecSuccess || status == errSecItemNotFound {
            return .success(())
        }
        return .failure(.keychain("SecItemDelete failed: \(status)"))
    }

    private func deleteCredentialRaw(key: String) -> OSStatus {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key
        ]
        return SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Error mapping

enum BiometricError: Error {
    case notAvailable(String?)
    case notEnrolled(String?)
    case lockedOut(String?)
    case authFailed(String?)
    case userCancelled
    case invalidParams(String)
    case keychain(String)
    case notFound

    var code: String {
        switch self {
        case .notAvailable: return "BIOMETRIC_NOT_AVAILABLE"
        case .notEnrolled: return "BIOMETRIC_NOT_ENROLLED"
        case .lockedOut: return "BIOMETRIC_LOCKED_OUT"
        case .authFailed: return "BIOMETRIC_AUTH_FAILED"
        case .userCancelled: return "BIOMETRIC_USER_CANCELLED"
        case .invalidParams: return "BIOMETRIC_INVALID_PARAMS"
        case .keychain: return "BIOMETRIC_KEYCHAIN_ERROR"
        case .notFound: return "BIOMETRIC_CREDENTIAL_NOT_FOUND"
        }
    }

    var message: String {
        switch self {
        case .notAvailable(let m): return m ?? "Biometric authentication is not available on this device"
        case .notEnrolled(let m): return m ?? "No biometrics are enrolled on this device"
        case .lockedOut(let m): return m ?? "Biometric authentication is locked out"
        case .authFailed(let m): return m ?? "Biometric authentication failed"
        case .userCancelled: return "User cancelled biometric authentication"
        case .invalidParams(let m): return m
        case .keychain(let m): return m
        case .notFound: return "No credential found for the provided key"
        }
    }

    var isCancellation: Bool {
        if case .userCancelled = self { return true }
        return false
    }

    static func from(laError: LAError?, fallback: String?) -> BiometricError {
        guard let laError else {
            return .authFailed(fallback)
        }
        switch laError.code {
        case .userCancel, .systemCancel, .appCancel:
            return .userCancelled
        case .biometryNotAvailable, .touchIDNotAvailable:
            return .notAvailable(laError.localizedDescription)
        case .biometryNotEnrolled, .touchIDNotEnrolled:
            return .notEnrolled(laError.localizedDescription)
        case .biometryLockout, .touchIDLockout:
            return .lockedOut(laError.localizedDescription)
        case .authenticationFailed:
            return .authFailed(laError.localizedDescription)
        default:
            return .authFailed(laError.localizedDescription)
        }
    }
}
