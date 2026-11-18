import AVFoundation
import CatalystCoreLogic
import Speech

/// Speech to text by the platform's own recognizer, on the device only; the iOS counterpart of Android's
/// SpeechRecognitionManager. Recognition never goes to Apple's servers: `requiresOnDeviceRecognition` is set, and a
/// locale without an on-device model is refused with ON_DEVICE_UNAVAILABLE instead of falling back. Partial text
/// streams while the person talks and a final text arrives once they pause (or stop); the session then ends, as on
/// Android.
final class SpeechRecognitionManager {

    typealias Send = (_ event: String, _ payload: [String: Any]) -> Void

    /// How long a pause ends the session once something was heard (the Android recognizer ends itself the same way).
    private static let silenceSeconds: TimeInterval = 2.0

    private let send: Send
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var lastText = ""
    private var finished = false
    private struct SavedSession {
        let category: AVAudioSession.Category
        let mode: AVAudioSession.Mode
        let options: AVAudioSession.CategoryOptions
    }
    private var savedSession: SavedSession?

    init(send: @escaping Send) {
        self.send = send
    }

    private static func authorization() -> SpeechAuthorization {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return .authorized
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    private func fail(_ code: String, _ message: String) {
        send("SPEECH_RECOGNITION_ERROR", SpeechRecognitionPolicy.errorPayload(code: code, message: message))
    }

    // MARK: - Support

    /// Answers SPEECH_RECOGNITION_SUPPORT: can the device recognise this language without leaving it.
    func getSupport(language: String) {
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language))
        let reason = SpeechRecognitionPolicy.refusal(
            recognizerExists: recognizer != nil,
            available: recognizer?.isAvailable ?? false,
            supportsOnDevice: recognizer?.supportsOnDeviceRecognition ?? false,
            authorization: Self.authorization()
        )
        send("SPEECH_RECOGNITION_SUPPORT", SpeechRecognitionPolicy.supportPayload(
            available: reason == nil,
            language: language,
            installed: recognizer?.supportsOnDeviceRecognition ?? false,
            reason: reason
        ))
    }

    // MARK: - Session

    func start(language: String) {
        guard task == nil else {
            fail(SpeechRecognitionPolicy.Code.busy, "Speech recognition is already running")
            return
        }
        guard MicrophonePermission.authorization() == .authorized else {
            fail(SpeechRecognitionPolicy.Code.permissionDenied, "Microphone permission is needed")
            return
        }
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language))
        if let reason = SpeechRecognitionPolicy.refusal(
            recognizerExists: recognizer != nil,
            available: recognizer?.isAvailable ?? false,
            supportsOnDevice: recognizer?.supportsOnDeviceRecognition ?? false,
            authorization: .authorized
        ) {
            fail(reason, "On-device speech recognition is not available for \(language)")
            return
        }
        guard let recognizer = recognizer else { return }

        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard status == .authorized else {
                    self.fail(SpeechRecognitionPolicy.Code.permissionDenied, "Speech recognition was refused")
                    return
                }
                self.begin(with: recognizer)
            }
        }
    }

    private func begin(with recognizer: SFSpeechRecognizer) {
        guard task == nil else { return }
        finished = false
        lastText = ""
        do {
            try activateSession()
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = true
            self.request = request

            let input = audioEngine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            audioEngine.prepare()
            try audioEngine.start()

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async { self?.handle(result: result, error: error) }
            }
            send("SPEECH_RECOGNITION_STATE", SpeechRecognitionPolicy.statePayload("listening"))
        } catch {
            teardown()
            fail(SpeechRecognitionPolicy.Code.audio, "Could not start listening: \(error.localizedDescription)")
        }
    }

    private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
        guard !finished else { return }
        if let result = result {
            let text = result.bestTranscription.formattedString
            lastText = text
            if result.isFinal {
                finish(with: text)
                return
            }
            if !text.isEmpty {
                send("SPEECH_RECOGNITION_PARTIAL", SpeechRecognitionPolicy.textPayload(text))
                restartSilenceTimer()
            }
        }
        if let error = error as NSError? {
            // After a stop the task may report an error once it has delivered what it heard; keep what it heard.
            if !lastText.isEmpty {
                finish(with: lastText)
                return
            }
            let code = SpeechRecognitionPolicy.errorCode(domain: error.domain, code: error.code)
            finished = true
            teardown()
            fail(code, error.localizedDescription)
            send("SPEECH_RECOGNITION_STATE", SpeechRecognitionPolicy.statePayload("idle"))
        }
    }

    private func finish(with text: String) {
        finished = true
        teardown()
        send("SPEECH_RECOGNITION_FINAL", SpeechRecognitionPolicy.textPayload(text))
        send("SPEECH_RECOGNITION_STATE", SpeechRecognitionPolicy.statePayload("idle"))
    }

    private func restartSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: Self.silenceSeconds, repeats: false) { [weak self] _ in
            self?.stop()
        }
    }

    /// Ends the audio; the recognizer then delivers the final text for what it heard.
    func stop() {
        silenceTimer?.invalidate()
        guard task != nil, !finished else { return }
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
    }

    func cleanup() {
        finished = true
        task?.cancel()
        teardown()
    }

    private func teardown() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request = nil
        task = nil
        restoreSession()
    }

    // MARK: - Audio session (the web view's own audio must come back as it was)

    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        savedSession = SavedSession(category: session.category, mode: session.mode, options: session.categoryOptions)
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func restoreSession() {
        guard let saved = savedSession else { return }
        savedSession = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(saved.category, mode: saved.mode, options: saved.options)
    }
}
