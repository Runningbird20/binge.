import AVFoundation
import Foundation
import Testing
import UIKit
@testable import BingeTV

// The bridge script drives every server's <video> (play, pause, seek, mute,
// fill, audio/subtitle tracks, the subtitle line the app draws). These tests
// run it in the real tvOS WebKit engine against a local page: a generated
// video with two WebVTT tracks, top-level and inside a nested iframe (the
// live-sports layout).
@MainActor @Suite(.serialized) struct BridgeTests {
    static let folder: URL = {
        let dir = FileManager.default.temporaryDirectory.appending(path: "bridge-fixture")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    // 20s of 640×360 H.264, the frame colour changing each second.
    static func makeVideo() async throws -> URL {
        let url = folder.appending(path: "clip.mp4")
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 640, AVVideoHeightKey: 360,
        ])
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: 640,
            kCVPixelBufferHeightKey as String: 360,
        ])
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)
        let fps: Int32 = 10
        for frame in 0..<(20 * Int(fps)) {
            while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(5)) }
            var buffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
            guard let buffer else { continue }
            CVPixelBufferLockBaseAddress(buffer, [])
            let shade = UInt8((frame / Int(fps)) * 12 % 255)
            memset(CVPixelBufferGetBaseAddress(buffer), Int32(shade), CVPixelBufferGetDataSize(buffer))
            CVPixelBufferUnlockBaseAddress(buffer, [])
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
        }
        input.markAsFinished()
        await writer.finishWriting()
        #expect(writer.status == .completed, "\(writer.error?.localizedDescription ?? "")")
        return url
    }

    static let english = """
    WEBVTT

    00:00:00.500 --> 00:00:03.000
    First &amp; <i>foremost</i>

    00:00:04.000 --> 00:00:07.000
    Second line
    on two rows

    00:00:10.000 --> 00:00:12.000
    Tom &amp;lt;3
    """

    static let spanish = """
    WEBVTT

    00:00:00.500 --> 00:00:03.000
    Primero

    00:00:04.000 --> 00:00:07.000
    Segundo
    """

    static func page(nested: Bool) async throws -> URL {
        _ = try await makeVideo()
        try english.write(to: folder.appending(path: "en.vtt"), atomically: true, encoding: .utf8)
        try spanish.write(to: folder.appending(path: "es.vtt"), atomically: true, encoding: .utf8)
        let player = """
        <!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#222">
        <div id="wrap" style="width:640px;height:360px;transform:translateX(10px)">
        <video id="v" src="clip.mp4" muted playsinline preload="auto" style="width:640px;height:360px">
          <track kind="subtitles" srclang="en" label="English" src="en.vtt">
          <track kind="subtitles" srclang="es" label="Spanish" src="es.vtt">
          <track kind="chapters" srclang="en" label="Chapters" src="en.vtt">
        </video></div><button id="ad">Ad</button></body></html>
        """
        try player.write(to: folder.appending(path: "player.html"), atomically: true, encoding: .utf8)
        let outer = """
        <!doctype html><html><body style="margin:0"><p>Server page</p>
        <iframe id="f" src="player.html" style="width:700px;height:400px;border:0"></iframe></body></html>
        """
        try outer.write(to: folder.appending(path: "outer.html"), atomically: true, encoding: .utf8)
        return folder.appending(path: nested ? "outer.html" : "player.html")
    }

    @MainActor final class Harness {
        let web: ModernWebView
        init(_ web: ModernWebView) { self.web = web }

        func state() -> MediaState? {
            var result: MediaState?
            web.poll { result = $0 }
            return result
        }

        func waitFor(_ what: String, timeout: Double = 20, _ condition: (MediaState) -> Bool) async throws -> MediaState {
            let start = Date()
            while Date().timeIntervalSince(start) < timeout {
                if let s = state(), condition(s) { return s }
                try await Task.sleep(for: .milliseconds(100))
            }
            Issue.record("timed out waiting for \(what); last state: \(String(describing: state()))")
            throw CancellationError()
        }

        func js(_ script: String) async -> String? {
            await withCheckedContinuation { done in web.evaluate(script) { done.resume(returning: $0) } }
        }
    }

    private func open(nested: Bool) async throws -> Harness {
        let url = try await Self.page(nested: nested)
        let web = try #require(ModernWebView(allowedHost: nil))
        // In a window, like the player (some decoders won't run off-screen).
        let window = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        web.view.frame = CGRect(x: 0, y: 0, width: 960, height: 540)
        web.view.alpha = 0.02
        window?.addSubview(web.view)
        _ = web.view.perform(NSSelectorFromString("loadFileURL:allowingReadAccessToURL:"), with: url as NSURL, with: Self.folder as NSURL)
        return Harness(web)
    }

    private func close(_ h: Harness) {
        h.web.send(.stop)
        h.web.view.removeFromSuperview()
    }

    @Test func reportsTheVideoAndItsTracks() async throws {
        let h = try await open(nested: false)
        defer { close(h) }
        let s = try await h.waitFor("tracks") { $0.ready >= 1 && $0.text.count == 2 }
        #expect(s.video)
        #expect(abs(s.d - 20) < 0.6, "duration \(s.d)")
        #expect(s.height == 360)
        #expect(s.text.map(\.label) == ["English", "Spanish"], "chapters aren't subtitles")
        #expect(s.text.map(\.language) == ["en", "es"])
        #expect(s.text.map(\.index) == [0, 1])
        #expect(s.paused)
    }

    @Test func playPauseToggleSeek() async throws {
        let h = try await open(nested: false)
        defer { close(h) }
        _ = try await h.waitFor("loaded") { $0.ready >= 1 }
        h.web.send(.play)
        let playing = try await h.waitFor("playing") { !$0.paused && $0.t > 0.5 }
        #expect(playing.t < 5)
        h.web.send(.pause)
        let paused = try await h.waitFor("paused") { $0.paused }
        try await Task.sleep(for: .milliseconds(900))
        #expect(abs((h.state()?.t ?? 0) - paused.t) < 0.2, "clock stays put while paused")
        h.web.send(.seekTo(12))
        _ = try await h.waitFor("seekTo 12") { abs($0.t - 12) < 0.3 }
        h.web.send(.seekBy(-10))
        _ = try await h.waitFor("seekBy -10") { abs($0.t - 2) < 0.3 }
        h.web.send(.seekBy(-30))
        _ = try await h.waitFor("clamped at 0") { $0.t < 0.3 }
        h.web.send(.seekBy(500))
        _ = try await h.waitFor("clamped before the end") { $0.t > 18 && $0.t <= 19.1 }
        h.web.send(.toggle)
        _ = try await h.waitFor("toggle plays") { !$0.paused }
        h.web.send(.toggle)
        _ = try await h.waitFor("toggle pauses") { $0.paused }
    }

    @Test func subtitlesAreHiddenAndTheirLineIsReported() async throws {
        let h = try await open(nested: false)
        defer { close(h) }
        _ = try await h.waitFor("tracks") { $0.ready >= 1 && $0.text.count == 2 }
        h.web.send(.textTrack(0))
        h.web.send(.seekTo(1))
        let first = try await h.waitFor("English line") { !$0.cue.isEmpty }
        #expect(first.cue == "First & foremost", "markup stripped, entities decoded")
        #expect(first.text.first { $0.on }?.index == 0)
        #expect(first.text[0].cues == 3, "all English cues loaded")
        // WebKit keeps it "hidden": cues load but WebKit draws nothing itself.
        #expect(await h.js("document.getElementById('v').textTracks[0].mode") == "hidden")
        #expect(await h.js("document.getElementById('v').textTracks[1].mode") == "disabled")

        h.web.send(.seekTo(5))
        let second = try await h.waitFor("two-row line") { $0.cue.hasPrefix("Second") }
        #expect(second.cue == "Second line\non two rows")

        h.web.send(.seekTo(11))
        let third = try await h.waitFor("entity line") { $0.cue.hasPrefix("Tom") }
        #expect(third.cue == "Tom &lt;3", "&amp;lt; decodes once")

        h.web.send(.seekTo(8.5))
        _ = try await h.waitFor("gap between lines") { $0.cue.isEmpty && abs($0.t - 8.5) < 0.3 }

        h.web.send(.textTrack(1))
        h.web.send(.seekTo(5))
        let spanish = try await h.waitFor("Spanish line") { $0.cue == "Segundo" }
        #expect(spanish.text.first { $0.on }?.label == "Spanish")

        h.web.send(.textTrack(-1))
        h.web.send(.seekTo(1))
        let off = try await h.waitFor("subtitles off") { abs($0.t - 1) < 0.3 }
        try await Task.sleep(for: .milliseconds(600))
        #expect(h.state()?.cue == "")
        #expect(off.text.allSatisfy { !$0.on })
    }

    @Test func serverShownTrackIsAdopted() async throws {
        let h = try await open(nested: false)
        defer { close(h) }
        _ = try await h.waitFor("tracks") { $0.ready >= 1 && $0.text.count == 2 }
        // The server turned Spanish on itself; the bridge takes it over.
        _ = await h.js("document.getElementById('v').textTracks[1].mode='showing';document.getElementById('v').currentTime=1;'ok'")
        let s = try await h.waitFor("adopted line") { $0.cue == "Primero" }
        #expect(s.text.first { $0.on }?.index == 1)
        #expect(await h.js("document.getElementById('v').textTracks[1].mode") == "hidden")
    }

    @Test func captionStyleAndFill() async throws {
        let h = try await open(nested: false)
        defer { close(h) }
        _ = try await h.waitFor("loaded") { $0.ready >= 1 }
        h.web.send(.captionStyle(size: 175, background: "rgba(0,0,0,1)"))
        try await Task.sleep(for: .milliseconds(200))
        let css = await h.js("document.getElementById('__bcue').textContent") ?? ""
        #expect(css.contains("font-size:175%"))
        #expect(css.contains("background-color:rgba(0,0,0,1)"))

        h.web.send(.fill)
        try await Task.sleep(for: .milliseconds(300))
        #expect(await h.js("document.getElementById('v').classList.contains('__bf-el')+''") == "true")
        #expect(await h.js("document.documentElement.classList.contains('__bf')+''") == "true")
        // The transformed wrapper would trap a fixed video; fill resets it.
        #expect(await h.js("getComputedStyle(document.getElementById('wrap')).transform") == "none")
        #expect(await h.js("getComputedStyle(document.getElementById('ad')).visibility") == "hidden")
        let rect = await h.js("(function(){var r=document.getElementById('v').getBoundingClientRect();return r.left+','+r.top+','+r.width+','+r.height})()")
        #expect(rect == "0,0,960,540", "video covers the viewport: \(rect ?? "-")")

        h.web.send(.unfill)
        try await Task.sleep(for: .milliseconds(300))
        #expect(await h.js("document.getElementById('v').classList.contains('__bf-el')+''") == "false")
    }

    @Test func nestedFrameIsReachable() async throws {
        let h = try await open(nested: true)
        defer { close(h) }
        let s = try await h.waitFor("video in the iframe") { $0.ready >= 1 && $0.text.count == 2 }
        #expect(abs(s.d - 20) < 0.6)
        h.web.send(.play)
        _ = try await h.waitFor("plays through the relay") { !$0.paused && $0.t > 0.5 }
        h.web.send(.seekTo(10.5))
        _ = try await h.waitFor("seeks through the relay") { abs($0.t - 10.5) < 0.6 }
        h.web.send(.pause)
        h.web.send(.textTrack(0))
        let line = try await h.waitFor("cue from the iframe") { $0.cue.hasPrefix("Tom") }
        #expect(line.cue == "Tom &lt;3")
        h.web.send(.fill)
        try await Task.sleep(for: .milliseconds(500))
        // The iframe holding the video is pinned over the whole page too.
        #expect(await h.js("document.getElementById('f').classList.contains('__bf-el')+''") == "true")
    }

    @Test func mutedUntilAskedAndLiveCountTracksEngines() async throws {
        let before = WebEngines.liveCount
        let h = try await open(nested: false)
        #expect(WebEngines.liveCount == before + 1)
        _ = try await h.waitFor("loaded") { $0.ready >= 1 }
        h.web.send(.unmute)
        try await Task.sleep(for: .milliseconds(200))
        #expect(await h.js("document.getElementById('v').muted+''") == "false")
        h.web.send(.mute)
        try await Task.sleep(for: .milliseconds(200))
        #expect(await h.js("document.getElementById('v').muted+''") == "true")
        close(h)
    }

    @Test func topLevelNavigationIsLockedToTheServer() async throws {
        let web = try #require(ModernWebView(allowedHost: "vidy.st"))
        defer { web.view.removeFromSuperview() }
        func decide(_ url: String, main: Bool) -> Int {
            var decision = -1
            web.webView(web.view, decidePolicyFor: FakeNavigation(url, main), decisionHandler: { decision = $0 })
            return decision
        }
        #expect(decide("https://vidy.st/movie/1", main: true) == 1)
        #expect(decide("https://www.vidy.st/movie/1", main: true) == 1)
        #expect(decide("https://ads.example.com/landing", main: true) == 0, "ad redirect blocked")
        #expect(decide("https://evilvidy.st/", main: true) == 0)
        #expect(decide("https://ads.example.com/frame", main: false) == 1, "frames may load anything")
        #expect(decide("about:blank", main: true) == 1)
    }
}

// Stand-ins for WKNavigationAction / WKFrameInfo (read through KVC by the engine).
final class FakeFrame: NSObject {
    @objc var mainFrame: Bool
    init(_ main: Bool) { mainFrame = main }
}

final class FakeNavigation: NSObject {
    @objc var request: URLRequest
    @objc var targetFrame: FakeFrame
    init(_ url: String, _ main: Bool) {
        request = URLRequest(url: URL(string: url)!)
        targetFrame = FakeFrame(main)
    }
}
