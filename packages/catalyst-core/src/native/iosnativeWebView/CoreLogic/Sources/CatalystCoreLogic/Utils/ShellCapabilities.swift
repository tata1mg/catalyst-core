import Foundation

/// What this app shell can do, announced to the page before it runs as `window.CatalystShell.capabilities`.
///
/// A WKWebView message handler cannot answer "do you know this command?": a command an older shell does not know is dropped without a
/// reply. A page that waited for that reply would sit out its whole timeout. The page therefore asks this list instead, and a shell that
/// predates the list (no `CatalystShell` at all) is recognised as old at once.
public enum ShellCapabilities {
    /// Add a name here when a bridge command with an asynchronous answer ships, and read it on the page before relying on it.
    public static let names: [String] = ["microphonePermission", "speechRecognition"]

    /// JavaScript run at document start. The names are fixed strings, so nothing here comes from page or user input.
    public static var scriptSource: String {
        let flags = names.map { "\"\($0)\":true" }.joined(separator: ",")
        return "window.CatalystShell = {\"capabilities\":{\(flags)}};"
    }
}
