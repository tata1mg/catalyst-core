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
    /// Set once the bridge is torn down. A speech-authorization answer can arrive after that; it must not start work.
    private var cleanedUp = false
    /// Which start() a speech-authorization answer belongs to. stop() and cleanup() move it on, so an answer that arrives
    /// after the caller stopped (or the bridge went away) is ignored instead of starting recognition.
    private var generation = 0
    /// Moves on with every recognition task that begins; a callback from an earlier task is recognised by an older number and ignored.
    private var taskSerial = 0
    private var authorizationPending = false
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
        // `installed` is left out on purpose: supportsOnDeviceRecognition says the language CAN run on the device, not
        // that its model files are there (the iOS Simulator has none). Whether it works is only known by starting;
        // a failed start comes back as ON_DEVICE_UNAVAILABLE and the page then stops offering it.
        send("SPEECH_RECOGNITION_SUPPORT", SpeechRecognitionPolicy.supportPayload(
            available: reason == nil,
            language: language,
            reason: reason
        ))
    }

    // MARK: - Session

    func start(language: String) {
        // Busy also while the Speech permission prompt is open: `task` is still nil then, and a second start() would advance `generation`,
        // so the first one's answer would be thrown away without ever reporting a result.
        guard task == nil, !authorizationPending else {
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

        generation += 1
        let mine = generation
        authorizationPending = true
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self, !self.cleanedUp, mine == self.generation else { return }
                self.authorizationPending = false
                guard status == .authorized else {
                    self.fail(SpeechRecognitionPolicy.Code.permissionDenied, "Speech recognition was refused")
                    return
                }
                self.begin(with: recognizer)
            }
        }
    }

    private func begin(with recognizer: SFSpeechRecognizer) {
        guard !cleanedUp, task == nil else { return }
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
            // Microphone permission does not guarantee a usable input: with no input (or one that reports no format) installing a tap raises
            // an Objective-C exception that a Swift catch cannot handle. Check the format first and fail like any other audio problem.
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw NoAudioInput() }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            audioEngine.prepare()
            try audioEngine.start()

            taskSerial += 1
            let serial = taskSerial
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                // A callback queued by an earlier task can run after a newer task has begun (it resets `finished`): it must not publish its
                // text as the new session's or tear the new session down.
                DispatchQueue.main.async {
                    guard let self = self, serial == self.taskSerial else { return }
                    self.handle(result: result, error: error)
                }
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
            let description = error.localizedDescription
            let code = SpeechRecognitionPolicy.errorCode(domain: error.domain, code: error.code, message: description)
            finished = true
            teardown()
            let message = SpeechRecognitionPolicy.errorMessage(
                domain: error.domain,
                code: error.code,
                description: description
            )
            fail(code, message)
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
        generation += 1
        if authorizationPending && task == nil {
            // Stopped while the permission prompt was open: nothing is recording yet, and nothing may start when it is answered.
            authorizationPending = false
            fail(SpeechRecognitionPolicy.Code.cancelled, "Speech recognition was stopped before it began")
            send("SPEECH_RECOGNITION_STATE", SpeechRecognitionPolicy.statePayload("idle"))
            return
        }
        guard task != nil, !finished else { return }
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
    }

    func cleanup() {
        cleanedUp = true
        generation += 1
        authorizationPending = false
        finished = true
        task?.cancel()
        teardown()
    }

    private struct NoAudioInput: LocalizedError {
        var errorDescription: String? { "No microphone input is available right now" }
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
        // `.duckOthers` is not valid with the `.record` category (it belongs to playback-style categories) and the system may reject the pair, and
        // `.notifyOthersOnDeactivation` is only for deactivating. Plain record: other audio is interrupted for the session either way.
        try session.setCategory(.record, mode: .measurement, options: [])
        try session.setActive(true)
    }

    private func restoreSession() {
        guard let saved = savedSession else { return }
        savedSession = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(saved.category, mode: saved.mode, options: saved.options)
    }
}
