import XCTest

// Screenshots of the Home, title page, person page and Sports additions
// (BINGE_SHOTS/<name>.png), signed in with BINGE_EMAIL / BINGE_PASSWORD
// (skipped without them).
final class FeaturesUITests: XCTestCase {
    private let remote = XCUIRemote.shared

    private func shot(_ name: String) {
        let image = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = ProcessInfo.processInfo.environment["BINGE_SHOTS"] {
            try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            try? image.pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
        }
    }

    private func press(_ button: XCUIRemote.Button, _ times: Int = 1) {
        for _ in 0..<times { remote.press(button); Thread.sleep(forTimeInterval: 0.6) }
    }

    private func launch(_ extra: [String]) throws -> XCUIApplication {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["BINGE_EMAIL"], let password = env["BINGE_PASSWORD"] else { throw XCTSkip("Needs BINGE_EMAIL / BINGE_PASSWORD") }
        let app = XCUIApplication()
        app.launchArguments = ["-BingeEmail", email, "-BingePassword", password, "-binge.ambient", "NO"] + extra
        app.launch()
        return app
    }

    func testHome() throws {
        let app = try launch(["-BingeTab", "home"])
        Thread.sleep(forTimeInterval: 14)
        shot("features-home")
        press(.down)
        Thread.sleep(forTimeInterval: 1)
        shot("features-home-surprise")
        app.terminate()
        // Second launch: the saved Home shows at once.
        let again = try launch(["-BingeTab", "home"])
        Thread.sleep(forTimeInterval: 2.5)
        shot("features-home-instant")
        again.terminate()
    }

    func testTitleAndPerson() throws {
        let app = try launch(["-BingeOpen", "tv_show:46545"])
        Thread.sleep(forTimeInterval: 10)
        press(.down)
        Thread.sleep(forTimeInterval: 1.5)
        shot("features-episodes")
        press(.down, 2)
        Thread.sleep(forTimeInterval: 2)
        shot("features-cast")
        press(.select)
        Thread.sleep(forTimeInterval: 6)
        shot("features-person")
        app.terminate()
    }

    func testSports() throws {
        let app = try launch(["-BingeTab", "sports", "-binge.sports.hideScores", "YES"])
        Thread.sleep(forTimeInterval: 14)
        press(.down, 3)
        Thread.sleep(forTimeInterval: 1)
        shot("features-sports-hidden")
        app.terminate()
    }

    // Continue Watching → play → Playback info → leave → back in (instant
    // resume) → the corner.
    func testResumeInfoAndCorner() throws {
        // Trailers off: the simulator draws one video at a time, and the
        // spotlight's trailer would take the corner's picture.
        let app = try launch(["-BingeTab", "home", "-binge.trailers", "NO"])
        Thread.sleep(forTimeInterval: 14)
        press(.down, 3)
        Thread.sleep(forTimeInterval: 1)
        shot("viewing-0-cw-focus")
        press(.select)
        Thread.sleep(forTimeInterval: 25)
        shot("viewing-1-playing")
        press(.down)
        Thread.sleep(forTimeInterval: 1.5)
        shot("viewing-2-panel")
        press(.down, 7)
        Thread.sleep(forTimeInterval: 1)
        press(.select)
        Thread.sleep(forTimeInterval: 3)
        shot("viewing-3-info")
        press(.menu)
        press(.menu)
        Thread.sleep(forTimeInterval: 1)
        press(.menu)
        Thread.sleep(forTimeInterval: 3)
        shot("viewing-4-left")
        press(.select)
        Thread.sleep(forTimeInterval: 2.5)
        shot("viewing-5-resumed-2s")
        Thread.sleep(forTimeInterval: 6)
        press(.down)
        Thread.sleep(forTimeInterval: 1.5)
        press(.up)
        Thread.sleep(forTimeInterval: 0.8)
        shot("viewing-6-corner-button")
        press(.select)
        Thread.sleep(forTimeInterval: 5)
        shot("viewing-7-corner")
        app.terminate()
    }
}
