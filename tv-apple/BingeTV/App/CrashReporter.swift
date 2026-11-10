import Darwin
import Foundation

// Crashes go to the admin panel's Errors tab, like the website's
// utils/monitoring.js: POST {site}/api/ops/errors, which writes error_events.
// A crash can't send anything while it's happening, so the signal handler
// only writes the stack to a file that was opened at launch (write() and
// backtrace_symbols_fd() are safe there); the next launch sends it.
// Symbols are image offsets in Release builds ("BingeTV + 123456"),
// readable against the build's dSYM.
enum CrashReporter {
    nonisolated(unsafe) private static var fd: Int32 = -1
    private static var file: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "last-crash.txt")
    }

    static let signals: [Int32] = [SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGFPE]

    static func install() {
        #if DEBUG
        // Xcode's debugger shows crashes in development.
        if UserDefaults.standard.bool(forKey: "BingeCrashReports") == false { sendPending(); return }
        #endif
        sendPending()
        fd = open(file.path, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
        guard fd >= 0 else { return }
        frames = .allocate(capacity: 64)
        for number in signals {
            signal(number) { received in
                CrashReporter.record(signal: received)
                signal(received, SIG_DFL)
                raise(received)
            }
        }
        NSSetUncaughtExceptionHandler { exception in
            let text = "Uncaught exception: \(exception.name.rawValue): \(exception.reason ?? "")\n"
                + exception.callStackSymbols.joined(separator: "\n")
            CrashReporter.writeRaw(text)
        }
    }

    // Async-signal-safe: no allocation, no locks (the frame buffer is
    // allocated at launch).
    nonisolated(unsafe) private static var frames: UnsafeMutablePointer<UnsafeMutableRawPointer?>?
    private static func record(signal number: Int32) {
        guard fd >= 0 else { return }
        let name: StaticString
        switch number {
        case SIGABRT: name = "Crashed: SIGABRT\n"
        case SIGSEGV: name = "Crashed: SIGSEGV (bad memory access)\n"
        case SIGBUS: name = "Crashed: SIGBUS (bad memory access)\n"
        case SIGILL: name = "Crashed: SIGILL\n"
        case SIGTRAP: name = "Crashed: SIGTRAP (Swift runtime error)\n"
        case SIGFPE: name = "Crashed: SIGFPE\n"
        default: name = "Crashed: signal\n"
        }
        _ = write(fd, name.utf8Start, name.utf8CodeUnitCount)
        guard let frames else { return }
        let count = backtrace(frames, 64)
        backtrace_symbols_fd(frames, count, fd)
    }

    private static func writeRaw(_ text: String) {
        guard fd >= 0 else { return }
        let bytes = Array(text.utf8)
        _ = bytes.withUnsafeBufferPointer { write(fd, $0.baseAddress, $0.count) }
    }

    // The last session's crash, if there was one.
    private static func sendPending() {
        guard let text = try? String(contentsOf: file, encoding: .utf8), !text.isEmpty else { return }
        try? FileManager.default.removeItem(at: file)
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true)
        report(message: "Apple TV app: \(lines.first ?? "crashed")", stack: lines.dropFirst().joined(separator: "\n"))
    }

    // Any problem worth an admin's eye (also used for a crash on the next launch).
    static func report(message: String, stack: String? = nil, place: String = "apple-tv") {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        let body: [String: Any] = [
            "message": String(message.prefix(1000)),
            "stack": String((stack ?? "").prefix(4000)),
            "url": place,
            "release": "tvos-\(version)-\(build)",
        ]
        Task.detached {
            var request = URLRequest(url: Config.siteURL.appending(path: "api/ops/errors"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("binge-tv/\(version) (Apple TV; tvOS \(ProcessInfo.processInfo.operatingSystemVersionString))", forHTTPHeaderField: "User-Agent")
            // Signed in: the report says whose (the route reads the token).
            if let token = try? await Supabase.shared.validSession().accessToken {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
            _ = try? await URLSession.shared.data(for: request)
        }
    }
}
