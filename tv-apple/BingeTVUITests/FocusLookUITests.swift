import XCTest

// The focused card must be obvious from the couch (white border, glow,
// grow): screenshots of a focused poster and wide card for a visual check
// (BINGE_SHOTS/<name>.png), and rows that keep going past their last card.
final class FocusLookUITests: XCTestCase {
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
        for _ in 0..<times { remote.press(button); Thread.sleep(forTimeInterval: 0.5) }
    }

    func testFocusedCardsStandOut() {
        let app = XCUIApplication()
        app.launchArguments = ["-BingeDemo", "-BingeTab", "movies", "-binge.ambient", "NO"]
        app.launch()
        Thread.sleep(forTimeInterval: 10)
        press(.down, 2)
        press(.right)
        Thread.sleep(forTimeInterval: 1.5)
        shot("focus-movies-poster")
        // Far right in a row: it should keep going (wrap to the start).
        press(.right, 24)
        Thread.sleep(forTimeInterval: 1.5)
        shot("focus-movies-row-end")
        press(.right, 6)
        Thread.sleep(forTimeInterval: 1.5)
        shot("focus-movies-row-wrapped")
        app.terminate()
    }
}
