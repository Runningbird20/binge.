import SwiftUI

// "Profile Lock is currently on." The same screen as the website's, with an
// on-screen keypad for the remote. The PIN is checked on the server as soon
// as the fourth digit is in; Back returns to the profiles.
struct PinEntryView: View {
    @EnvironmentObject private var app: AppModel
    let profile: AccountProfile

    @State private var entry = PinEntry()
    @State private var checking = false
    @State private var error: String?
    @FocusState private var focusedKey: Int?

    private static let deleteKey = -1
    private let errorColor = Color(hex: 0xE87C03)

    var body: some View {
        VStack(spacing: 0) {
            Text("Profile Lock is currently on.")
                .font(.title3)
                .foregroundStyle(Theme.muted)
            Text("Enter your pin to access this profile.")
                .font(.system(size: 64, weight: .heavy))
                .multilineTextAlignment(.center)
                .padding(.top, 18)

            HStack(spacing: 24) {
                ForEach(0..<PinEntry.length, id: \.self) { index in box(index) }
            }
            .padding(.top, 56)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(entry.digits.count) of \(PinEntry.length) digits entered")

            Text(error ?? " ")
                .font(.headline)
                .foregroundStyle(errorColor)
                .padding(.top, 28)
                .accessibilityHidden(error == nil)

            keypad
                .padding(.top, 32)
                .disabled(checking)
                .focusSection()

            Button("Back to profiles") { app.pinProfile = nil }
                .padding(.top, 36)
        }
        .padding(Theme.edge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            ZStack {
                LinearGradient(colors: [Color(hex: 0x1A2030), Theme.background], startPoint: .top, endPoint: .center)
                RadialGradient(colors: [Color(hex: 0x50628C, opacity: 0.35), .clear], center: .top, startRadius: 0, endRadius: 900)
            }
            .ignoresSafeArea()
        }
        .onExitCommand { app.pinProfile = nil }
        .onAppear { focusedKey = 1 }
    }

    private func box(_ index: Int) -> some View {
        let filled = index < entry.digits.count
        let current = index == entry.digits.count && !checking
        return RoundedRectangle(cornerRadius: 14)
            .fill(LinearGradient(colors: [Color(hex: 0x151A26), Color(hex: 0x0D1018)], startPoint: .top, endPoint: .bottom))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(current ? Color.white : Color.white.opacity(error == nil ? 0.32 : 0), lineWidth: current ? 4 : 1.5)
            }
            .overlay {
                if error != nil && !current {
                    RoundedRectangle(cornerRadius: 14).strokeBorder(errorColor, lineWidth: 1.5)
                }
            }
            .overlay {
                if filled { Circle().fill(.white).frame(width: 22, height: 22) }
            }
            .frame(width: 110, height: 140)
    }

    private var keypad: some View {
        VStack(spacing: 20) {
            ForEach([[1, 2, 3], [4, 5, 6], [7, 8, 9]], id: \.self) { row in
                HStack(spacing: 20) {
                    ForEach(row, id: \.self) { digitKey($0) }
                }
            }
            HStack(spacing: 20) {
                Color.clear.frame(width: 150, height: 96)
                digitKey(0)
                Button { entry.deleteLast(); error = nil } label: {
                    Image(systemName: "delete.left")
                        .font(.system(size: 36, weight: .semibold))
                        .frame(width: 150, height: 96)
                }
                .focused($focusedKey, equals: Self.deleteKey)
                .accessibilityLabel("Delete")
            }
        }
    }

    private func digitKey(_ digit: Int) -> some View {
        Button { type(digit) } label: {
            Text("\(digit)")
                .font(.system(size: 44, weight: .semibold))
                .frame(width: 150, height: 96)
        }
        .focused($focusedKey, equals: digit)
    }

    private func type(_ digit: Int) {
        error = nil
        entry.type(digit)
        guard entry.isComplete else { return }
        checking = true
        let pin = entry.digits
        Task {
            let result = await app.unlock(with: pin)
            checking = false
            switch result {
            case .unlocked:
                break
            case .wrongPin:
                error = "Incorrect PIN. After five wrong tries, wait five minutes."
                entry.clear()
            case .failed(let message):
                error = message
                entry.clear()
            }
        }
    }
}
