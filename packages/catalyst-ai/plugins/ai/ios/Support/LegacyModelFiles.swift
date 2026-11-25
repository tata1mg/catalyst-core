import Foundation

/// Files an earlier version stored a model under. They are removed after the current file has been downloaded, never before, so a failed
/// update never costs the person the model they already have.
enum LegacyModelFiles {
    private static let suffixes = ["", ".tmp", ".tmp.etag"]

    /// Deletes each legacy file and its temporary download files from `directory`. Returns the names that were removed.
    @discardableResult
    static func remove(in directory: URL, names: [String]) -> [String] {
        var removed: [String] = []
        for name in names {
            // A name that is not a plain file name (a path) is never followed out of the models directory.
            guard (name as NSString).lastPathComponent == name else { continue }
            for suffix in suffixes {
                let file = directory.appendingPathComponent(name + suffix)
                var isDirectory: ObjCBool = false
                guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue else { continue }
                if (try? FileManager.default.removeItem(at: file)) != nil { removed.append(name + suffix) }
            }
        }
        return removed
    }
}
