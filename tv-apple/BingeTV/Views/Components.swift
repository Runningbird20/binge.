import SwiftUI
import CoreImage.CIFilterBuiltins

// The site's palette: near-black background, charcoal surfaces, gold accent.
enum Theme {
    static let background = Color(hex: 0x0B0D12)
    static let surface = Color(hex: 0x12151D)
    static let raised = Color(hex: 0x1A1F2B)
    static let gold = Color(hex: 0xF5C451)
    static let muted = Color.white.opacity(0.62)
    static let edge: CGFloat = 80 // tvOS horizontal safe margin
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }

    init?(hexString: String?) {
        guard let hexString else { return nil }
        let cleaned = hexString.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        guard cleaned.count == 6, let value = UInt32(cleaned, radix: 16) else { return nil }
        self.init(hex: value)
    }
}

struct Wordmark: View {
    var size: CGFloat = 46
    var body: some View {
        Text("binge.")
            .font(.system(size: size, weight: .bold, design: .serif))
            .italic()
            .foregroundStyle(.white)
    }
}

// Poster with a graceful fallback (name on a charcoal card) while loading
// or when there's no art.
struct PosterImage: View {
    let url: URL?
    let name: String

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
            if let image = phase.image {
                image.resizable().aspectRatio(contentMode: .fill)
            } else {
                ZStack {
                    LinearGradient(colors: [Theme.raised, Theme.surface], startPoint: .top, endPoint: .bottom)
                    Text(name)
                        .font(.callout.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Theme.muted)
                        .padding(16)
                }
            }
        }
    }
}

struct Badge: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.heavy))
            .tracking(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.gold, in: Capsule())
            .foregroundStyle(.black)
    }
}

struct PosterCard: View {
    let title: Title
    var width: CGFloat = 220

    var body: some View {
        NavigationLink(value: title) {
            PosterImage(url: title.poster, name: title.name)
                .frame(width: width, height: width * 1.5)
                .clipped()
                .overlay(alignment: .topLeading) {
                    if title.comingSoon { Badge(text: "Coming soon").padding(10) }
                }
        }
        .buttonStyle(.card)
        .accessibilityLabel(title.name)
    }
}

struct SectionTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.title3.weight(.semibold))
            .foregroundStyle(.white.opacity(0.92))
    }
}

struct TitleRowView: View {
    let row: LoadedRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: row.title)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) {
                    ForEach(row.items) { PosterCard(title: $0) }
                }
                .padding(.vertical, 34) // room for the focus lift
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
        .focusSection()
    }
}

struct RowSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            RoundedRectangle(cornerRadius: 6).fill(Theme.raised).frame(width: 260, height: 30)
            HStack(spacing: 40) {
                ForEach(0..<7, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 12).fill(Theme.surface).frame(width: 220, height: 330)
                }
            }
        }
        .padding(.vertical, 20)
        .accessibilityHidden(true)
    }
}

struct ProblemView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 60))
                .foregroundStyle(Theme.gold)
            Text(message)
                .font(.headline)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 900)
            Button("Try again", action: retry)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
    }
}

enum QRCode {
    static func image(for text: String) -> Image? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 14, y: 14)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return Image(decorative: cgImage, scale: 1)
    }
}

struct QRCodeView: View {
    let url: URL
    var size: CGFloat = 420

    var body: some View {
        Group {
            if let image = QRCode.image(for: url.absoluteString) {
                image.interpolation(.none).resizable().scaledToFit()
            } else {
                Color.white
            }
        }
        .frame(width: size, height: size)
        .padding(28)
        .background(.white, in: RoundedRectangle(cornerRadius: 28))
        .accessibilityLabel("QR code for \(url.absoluteString)")
    }
}

extension View {
    func titleDestinations() -> some View {
        navigationDestination(for: Title.self) { TitleDetailView(title: $0) }
    }
}

extension Title {
    var metaLine: String {
        [year.map(String.init), ageRating, genre?.split(separator: ",").prefix(2).map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: ", ")]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "  ·  ")
    }
}
