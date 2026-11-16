//
//  AIPromptBuilder.swift
//  catalyst-ai (iOS)
//
//  Kotlin equivalent: NativeBridgeAI.buildSystemPrompt(). Text and component summary are kept
//  identical so both platforms steer the model the same way.
//

import Foundation

enum AIPromptBuilder {
    /// The app's systemPrompt, plus the attachment-component instructions when components are registered.
    static func build(_ options: AIOptions, log: (String) -> Void = { _ in }) -> String {
        let components = options.attachmentComponents
        guard !components.isEmpty else {
            log("[attachments] No attachmentComponents provided — using the app systemPrompt only (\(options.systemPrompt.count) chars)")
            return options.systemPrompt
        }

        let names = components.keys.sorted()
        log("[attachments] Received \(names.count) component(s): \(names.joined(separator: ", "))")

        var lines: [String] = []
        if !options.systemPrompt.isEmpty {
            lines.append(options.systemPrompt)
            lines.append("")
        }
        lines.append("Never use markdown headers, bullet points, numbered lists, or bold. Instead use these components: <tool:create_attachment component='Name' [attr='val']>body</tool:create_attachment>")
        let summary = names.map { name -> String in
            let hint = ((components[name] as? [String: Any])?["hint"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return hint.isEmpty ? name : "\(name) (\(hint))"
        }.joined(separator: ", ")
        lines.append("Available components: \(summary)")

        let prompt = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        names.forEach { log("[attachments] Registered component: \($0)") }
        log("[attachments] System prompt set (\(prompt.count) chars)")
        return prompt
    }
}
