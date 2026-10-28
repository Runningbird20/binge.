import XCTest

// Drives the app with the Siri Remote the way a viewer would, checks that
// every page loads (no error state, focus lands somewhere and moves), and
// saves a screenshot of each screen (attachments, plus BINGE_SHOTS/<name>.png
// when that folder is set) for a visual review.
final class NavigationUITests: XCTestCase {
    private let remote = XCUIRemote.shared
    private var app: XCUIApplication!

    // Catalog rows (binge. ids) used by the debug launch arguments.
    private let breakingBad = "tv_show:45424"
    private let squidGame = "tv_show:58132"
    private let frieren = "tv_show:48819"
    private let fightClub = "movie:197851"
    private let parasite = "movie:221056"

    override func setUp() {
        continueAfterFailure = true
    }

    override func tearDown() {
        app?.terminate()
    }

    private func launch(_ args: [String], demo: Bool = true) {
        app = XCUIApplication()
        app.launchArguments = (demo ? ["-BingeDemo"] : []) + args + ["-binge.ambient", "NO"]
        app.launch()
    }

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

    private func press(_ button: XCUIRemote.Button, _ times: Int = 1, pause: Double = 0.45) {
        for _ in 0..<times {
            remote.press(button)
            Thread.sleep(forTimeInterval: pause)
        }
    }

    private var focusedLabel: String {
        // Buttons only (a trailer's web page reports its own in-page focus);
        // containers report focus too, so the last match is the innermost.
        let query = app.buttons.matching(NSPredicate(format: "hasFocus == true"))
        let count = query.count
        guard count > 0 else { return "none" }
        let focused = query.element(boundBy: count - 1)
        return focused.exists ? "\(focused.label)|\(focused.identifier)" : "none"
    }

    // A page is loaded when its error/empty texts are absent and it shows content.
    private func assertLoaded(_ page: String, timeout: Double = 25, file: StaticString = #filePath, line: UInt = #line) {
        let problem = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Couldn' OR label CONTAINS 'went wrong' OR label CONTAINS 'missing its settings'")).firstMatch
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, app.buttons.count < 4 { Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertFalse(problem.exists, "\(page) shows an error: \(problem.label)", file: file, line: line)
        XCTAssertGreaterThanOrEqual(app.buttons.count, 4, "\(page) has almost nothing to focus", file: file, line: line)
    }

    // Focus moved when the picture changed (poster cards aren't exposed as
    // buttons to accessibility, so their focus can't be read by name).
    private func assertFocusMoves(_ direction: XCUIRemote.Button, on page: String, file: StaticString = #filePath, line: UInt = #line) {
        let before = XCUIScreen.main.screenshot().pngRepresentation
        press(direction)
        Thread.sleep(forTimeInterval: 0.6)
        let after = XCUIScreen.main.screenshot().pngRepresentation
        XCTAssertNotEqual(before, after, "\(direction.rawValue) changed nothing on \(page)", file: file, line: line)
    }

    // MARK: Tabs

    func testEveryTabLoadsAndScrolls() {
        for tab in ["home", "movies", "series", "sports", "search", "me"] {
            launch(["-BingeTab", tab])
            Thread.sleep(forTimeInterval: 6)
            assertLoaded(tab)
            shot("tab-\(tab)-top")
            if tab == "search" || tab == "me" { app.terminate(); continue }
            press(.down, 2)                 // past the spotlight into the first row
            assertFocusMoves(.right, on: tab)
            press(.down, 3)
            shot("tab-\(tab)-scrolled")
            press(.down, 6, pause: 0.3)
            shot("tab-\(tab)-deep")
            app.terminate()
        }
    }

    func testTabBarWalk() {
        launch(["-BingeTab", "home"])
        Thread.sleep(forTimeInterval: 5)
        press(.up, 4)                   // up to the tab bar (Back on Home would leave the app)
        var seen: [String] = []
        for _ in 0..<6 {
            seen.append(focusedLabel)
            press(.right, pause: 1.2)
        }
        shot("tabbar")
        XCTAssertGreaterThanOrEqual(Set(seen).count, 5, "the tab bar didn't walk: \(seen)")
    }

    // MARK: Title pages

    func testTitlePages() {
        for (key, name) in [(fightClub, "movie-fightclub"), (parasite, "movie-parasite"), (breakingBad, "tv-breakingbad"),
                            (squidGame, "tv-squidgame"), (frieren, "tv-frieren")] {
            launch(["-BingeOpen", key])
            Thread.sleep(forTimeInterval: 7)
            assertLoaded(name)
            let play = app.buttons.containing(NSPredicate(format: "label CONTAINS[c] 'Play' OR label CONTAINS[c] 'Resume'")).firstMatch
            XCTAssertTrue(play.exists, "\(name) has no Play button")
            shot("title-\(name)-top")
            press(.down, 2)
            shot("title-\(name)-middle")
            press(.down, 4, pause: 0.35)
            shot("title-\(name)-bottom")
            app.terminate()
        }
    }

    // MARK: Player

    private func waitForPlayback(_ seconds: Double) -> Bool {
        // The loading card names the servers being raced; it goes away once one plays.
        let deadline = Date().addingTimeInterval(seconds)
        let loading = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Finding the fastest server'")).firstMatch
        Thread.sleep(forTimeInterval: 3)
        while Date() < deadline {
            if !loading.exists { return true }
            Thread.sleep(forTimeInterval: 1)
        }
        return false
    }

    func testPlayerHUDPanelAndControls() {
        launch(["-BingeOpen", breakingBad, "-BingePlay", "1:1"])
        let played = waitForPlayback(60)
        shot("player-started")
        XCTAssertTrue(played, "Breaking Bad S1E1 didn't start within a minute")
        press(.right)                       // +10s
        shot("player-hud-after-seek")
        press(.playPause)
        Thread.sleep(forTimeInterval: 1)
        shot("player-paused")
        press(.playPause)
        press(.down)                        // options sidebar
        Thread.sleep(forTimeInterval: 1)
        shot("player-panel")
        for i in 0..<6 {
            press(.down)
            press(.select)
            Thread.sleep(forTimeInterval: 0.8)
            shot("player-panel-pane-\(i)")
            press(.menu)
            Thread.sleep(forTimeInterval: 0.5)
        }
        press(.menu)
        press(.menu)
        Thread.sleep(forTimeInterval: 1)
        shot("player-closed")
    }

    func testForeignTitleSubtitles() {
        launch(["-BingeOpen", squidGame, "-BingePlay", "1:1"])
        let played = waitForPlayback(60)
        XCTAssertTrue(played, "Squid Game S1E1 didn't start")
        Thread.sleep(forTimeInterval: 20)   // past the cold open, so a line is on screen
        shot("player-squidgame-subtitles")
        let line = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Subtitle:'")).firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 30), "no subtitle line drawn on a Korean show with English subtitles on")
    }

    func testMoviePlayback() {
        launch(["-BingeOpen", parasite, "-BingePlay", "0"])
        XCTAssertTrue(waitForPlayback(60), "Parasite didn't start")
        Thread.sleep(forTimeInterval: 4)
        shot("player-parasite")
    }

    // MARK: Search

    func testSearch() {
        launch(["-BingeTab", "search"])
        Thread.sleep(forTimeInterval: 4)
        shot("search-empty")
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no search field")
        for query in ["Breaking Bad", "Breking Bad", "something like Severance but funnier"] {
            // tvOS has no taps: move focus up to the field, then type on its keyboard.
            var tries = 0
            while !field.hasFocus, tries < 6 { press(.up); tries += 1 }
            press(.select)
            app.typeText(query)
            Thread.sleep(forTimeInterval: 8)
            shot("search-\(query.replacingOccurrences(of: " ", with: "-"))")
            let nothing = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Nothing on binge.'")).firstMatch
            XCTAssertFalse(nothing.exists, "“\(query)” found nothing")
            app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: query.count))
            press(.menu)
        }
    }

    // MARK: Sports, Me, Library, sign-in

    func testSportsPageAndGameMenu() {
        launch(["-BingeTab", "sports"])
        Thread.sleep(forTimeInterval: 10)
        assertLoaded("sports")
        shot("sports-top")
        press(.down)
        remote.press(.select, forDuration: 1.5)   // hold: Add to Multiview / Watch in the corner
        Thread.sleep(forTimeInterval: 1)
        shot("sports-hold-menu")
        press(.menu)
        press(.down, 3)
        shot("sports-rows")
    }

    func testMePages() {
        launch(["-BingeTab", "me"])
        Thread.sleep(forTimeInterval: 4)
        shot("me")
        let links = app.buttons.allElementsBoundByIndex.map(\.label).filter { !$0.isEmpty }
        XCTAssertFalse(links.isEmpty)
        for index in 0..<min(links.count, 9) {
            launch(["-BingeTab", "me"])
            Thread.sleep(forTimeInterval: 3)
            press(.down, index, pause: 0.35)
            let label = focusedLabel
            press(.select)
            Thread.sleep(forTimeInterval: 3)
            shot("me-\(index)-\(label.split(separator: ":").dropFirst().first.map(String.init)?.prefix(24) ?? "item")")
            app.terminate()
        }
    }

    func testLibraryPage() {
        launch(["-BingeOpen", "page:library"])
        Thread.sleep(forTimeInterval: 4)
        shot("library-list")
        launch(["-BingeOpen", "page:library", "-BingeLibraryTab", "1"])
        Thread.sleep(forTimeInterval: 4)
        shot("library-ratings")
    }

    func testSignInScreen() {
        launch([], demo: false)
        Thread.sleep(forTimeInterval: 4)
        shot("signin-or-home")
    }

    func testLargerText() {
        launch(["-BingeTab", "home", "-binge.largeText", "YES"])
        Thread.sleep(forTimeInterval: 7)
        shot("home-larger-text")
        launch(["-BingeOpen", breakingBad, "-binge.largeText", "YES"])
        Thread.sleep(forTimeInterval: 7)
        shot("title-larger-text")
    }
}
