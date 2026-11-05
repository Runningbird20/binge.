import SwiftUI

// binge. on iPhone and iPad: the website's phone layout in a full-screen web view
// (BingeWebView.swift), plus what Safari can't do for it. Every pop-up and tab
// redirect from the video servers' players is refused, as in the TV apps (the
// website alone can only sandbox two servers). Links to other sites open in Safari,
// and files the site saves (Download my data, calendar .ics, Wrapped card) go to
// the share sheet. Web push doesn't reach an app's web view, so alerts only show
// inside the site.
@main
struct BingeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @StateObject private var page = BingePage()

    var body: some View {
        ZStack {
            Color(uiColor: bingeBackground).ignoresSafeArea()
            // Below the status bar, as in Safari (the site's headers don't leave room for it),
            // and down under the home indicator, which the site pads for itself
            // (env(safe-area-inset-bottom) with viewport-fit=cover).
            BingeWebView(page: page).ignoresSafeArea(edges: .bottom)
            if page.unreachable {
                OfflineView(retry: page.retry)
            }
        }
    }
}

struct OfflineView: View {
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.secondary)
            Text("Can’t reach binge.")
                .font(.title3.weight(.semibold))
            Text("Check your connection, then try again.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(Color(red: 214 / 255, green: 173 / 255, blue: 85 / 255))
                .foregroundStyle(Color(uiColor: bingeBackground))
                .padding(.top, 8)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: bingeBackground))
    }
}
