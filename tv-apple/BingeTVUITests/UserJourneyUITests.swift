import XCTest

// A viewer's evening, driven only by the Siri Remote: browse Home, open a
// show, watch, skip around, change subtitles, switch episode, back out,
// search, try a live game, check settings. Every step is timed (printed as
// "[journey] …") and screenshotted (journey-NN-*.png) for a UX review. Run it
// under scripts/apple-tv-constraints.sh to approximate Apple TV hardware.
final class UserJourneyUITests: XCTestCase {
    private let remote = XCUIRemote.shared
    private var app: XCUIApplication!
    private var step = 0
    private var clock = Date()

    override func setUp() { continueAfterFailure = true }

    private func press(_ button: XCUIRemote.Button, _ times: Int = 1, pause: Double = 0.6) {
        for _ in 0..<times { remote.press(button); Thread.sleep(forTimeInterval: pause) }
    }

    private func mark(_ name: String) {
        step += 1
        let seconds = Date().timeIntervalSince(clock)
        print(String(format: "[journey] %02d %@ — %.1fs", step, name, seconds))
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = String(format: "journey-%02d-%@", step, name)
        shot.lifetime = .keepAlways
        add(shot)
        if let folder = ProcessInfo.processInfo.environment["BINGE_SHOTS"] {
            try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            try? XCUIScreen.main.screenshot().pngRepresentation
                .write(to: URL(fileURLWithPath: folder).appendingPathComponent(String(format: "journey-%02d-%@.png", step, name)))
        }
        clock = Date()
    }

    private func waitFor(_ timeout: Double, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline { if condition() { return true }; Thread.sleep(forTimeInterval: 0.25) }
        return false
    }

    private var loadingPlayer: Bool {
        app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Finding the fastest server'")).firstMatch.exists
    }

    private func button(_ text: String) -> XCUIElement {
        app.buttons.containing(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    // A fresh launch on that tab (the journey's next part of the evening).
    private func goToTab(_ tab: String) {
        app.terminate()
        app.launchArguments = ["-BingeDemo", "-BingeTab", tab]
        app.launch()
        Thread.sleep(forTimeInterval: 5)
    }

    private var focusedButton: String {
        let query = app.buttons.matching(NSPredicate(format: "hasFocus == true"))
        let count = query.count
        return count > 0 ? query.element(boundBy: 0).label : ""
    }

    // Moves through the list (down, then back up) until a button whose label contains `text` has focus.
    @discardableResult
    private func focusRow(_ text: String, max: Int = 14) -> Bool {
        Thread.sleep(forTimeInterval: 0.5)
        for direction in [XCUIRemote.Button.down, .up] {
            for _ in 0..<max {
                if focusedButton.localizedCaseInsensitiveContains(text) { return true }
                press(direction, pause: 0.4)
            }
        }
        XCTFail("couldn't reach “\(text)” (focus: \(focusedButton))")
        return false
    }

    // Back until the player is gone.
    private func leavePlayer() {
        for _ in 0..<4 where app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Play' OR label BEGINSWITH 'Resume'")).count == 0 {
            press(.menu, pause: 1.2)
        }
    }

    func testAnEveningOfWatching() {
        app = XCUIApplication()
        app.launchArguments = ["-BingeDemo"]
        clock = Date()
        app.launch()

        // Home appears and fills.
        XCTAssertTrue(waitFor(30) { app.buttons.count > 12 }, "Home didn't fill in 30s")
        mark("home-loaded")

        // Into the first row, a couple of titles along, open one.
        press(.down, 2)
        press(.right, 2)
        mark("home-row-focus")
        press(.select)
        XCTAssertTrue(waitFor(20) { button("Play").exists || button("Resume").exists }, "title page has no Play")
        Thread.sleep(forTimeInterval: 2)
        mark("title-page")

        // Play is focused on open: one click starts it.
        press(.select)
        clock = Date()
        let started = waitFor(60) { !loadingPlayer }
        mark(started ? "playing" : "never-started")
        XCTAssertTrue(started, "the show didn't start within a minute")
        Thread.sleep(forTimeInterval: 8)
        mark("watching")

        // Skip ahead 30s, pause, resume.
        press(.right, 3, pause: 0.4)
        mark("after-skip")
        press(.playPause)
        Thread.sleep(forTimeInterval: 1.5)
        mark("paused")
        press(.playPause)

        // Options: Subtitles → Spanish.
        press(.down)
        Thread.sleep(forTimeInterval: 1)
        mark("options")
        focusRow("Subtitles")
        press(.select)
        Thread.sleep(forTimeInterval: 1)
        mark("subtitles-pane")
        focusRow("Spanish")
        press(.select)
        Thread.sleep(forTimeInterval: 10)
        mark("spanish-subtitles")

        // Options: Episodes → the next one.
        press(.down)
        Thread.sleep(forTimeInterval: 1)
        focusRow("Episodes")
        press(.select)
        Thread.sleep(forTimeInterval: 1)
        mark("episodes-pane")
        focusRow("2. ")
        press(.select)
        clock = Date()
        let next = waitFor(60) { !loadingPlayer }
        mark(next ? "next-episode-playing" : "next-episode-stuck")
        Thread.sleep(forTimeInterval: 5)
        // ▼ first hides Skip intro when it's showing (by design), then opens Options.
        for _ in 0..<2 where !app.staticTexts["Options"].exists { press(.down, pause: 1) }
        mark("options-on-episode-2")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'S1:E2'")).firstMatch.exists, "not on episode 2")
        press(.menu)

        // Back out to the title page, then Home.
        leavePlayer()
        Thread.sleep(forTimeInterval: 2)
        mark("back-on-title")
        press(.menu)
        Thread.sleep(forTimeInterval: 2)
        mark("back-on-home")

        // Search for something by name.
        goToTab("search")
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no search field")
        for _ in 0..<6 where !field.hasFocus { press(.up, pause: 0.4) }
        press(.select)               // opens its keyboard
        Thread.sleep(forTimeInterval: 1)
        mark("search-tab")
        app.typeText("squid game")
        Thread.sleep(forTimeInterval: 6)
        mark("search-results")
        press(.menu)
        press(.down, 2)
        press(.select)
        Thread.sleep(forTimeInterval: 4)
        mark("search-opened")
        press(.menu)

        // A live game.
        goToTab("sports")
        Thread.sleep(forTimeInterval: 6)
        mark("sports")
        press(.down)
        press(.select)
        clock = Date()
        let live = waitFor(45) { !loadingPlayer }
        mark(live ? "live-playing" : "live-stuck")
        Thread.sleep(forTimeInterval: 6)
        press(.right)               // next live game
        clock = Date()
        _ = waitFor(45) { !loadingPlayer }
        Thread.sleep(forTimeInterval: 3)
        mark("next-live-game")
        leavePlayer()
        Thread.sleep(forTimeInterval: 2)

        // Settings.
        goToTab("me")
        mark("me")
        press(.down, 2)
        press(.select)
        Thread.sleep(forTimeInterval: 2)
        mark("me-item")
    }
}
