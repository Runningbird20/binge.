import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var app: AppModel
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    private var canSubmit: Bool { !email.isEmpty && !password.isEmpty && !busy }

    var body: some View {
        HStack(spacing: 120) {
            VStack(alignment: .leading, spacing: 28) {
                Wordmark(size: 96)
                Text("Movies, series, books and live sports, picked for you.")
                    .font(.title3)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: 640, alignment: .leading)
                Text("New here? Create an account at \(Config.siteHost) on your phone or computer, then sign in here.")
                    .font(.callout)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: 640, alignment: .leading)
            }

            VStack(alignment: .leading, spacing: 30) {
                Text("Sign in")
                    .font(.title2.weight(.bold))
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .onSubmit(submit)
                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill")
                        .font(.callout)
                        .foregroundStyle(Color(hex: 0xFFB4A8))
                }
                Button(action: submit) {
                    HStack {
                        if busy { ProgressView() }
                        Text(busy ? "Signing in…" : "Sign in").frame(maxWidth: .infinity)
                    }
                }
                .disabled(!canSubmit)
                Text("Tip: an iPhone nearby can fill these in from the keyboard prompt.")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            .frame(width: 720)
            .padding(56)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 36))
        }
        .padding(Theme.edge)
        .onAppear {
            if !Config.isConfigured { error = BingeError.notConfigured.localizedDescription }
        }
    }

    private func submit() {
        guard canSubmit else { return }
        busy = true
        error = nil
        Task {
            do {
                try await app.signIn(email: email, password: password)
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}

struct ProfilePickerView: View {
    @EnvironmentObject private var app: AppModel
    @FocusState private var focused: String?

    var body: some View {
        VStack(spacing: 70) {
            Text("Who's watching?")
                .font(.system(size: 64, weight: .bold))
            if let error = app.profileLoadError {
                ProblemView(message: error) { Task { await app.loadProfiles() } }
            } else {
                HStack(spacing: 56) {
                    ForEach(app.profiles) { profile in
                        Button { app.choose(profile) } label: {
                            ProfileAvatar(profile: profile, size: 220)
                        }
                        .buttonStyle(.borderless)
                        .focused($focused, equals: profile.id)
                    }
                }
                .focusSection()
            }
            Button("Sign out") { Task { await app.signOut() } }
                .padding(.top, 20)
        }
        .padding(Theme.edge)
        .onAppear { focused = app.lastProfileId ?? app.profiles.first?.id }
    }
}

struct ProfileAvatar: View {
    let profile: AccountProfile
    var size: CGFloat = 200

    private var color: Color { Color(hexString: profile.avatarColor) ?? Color(hex: 0x3B4A7A) }

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.16).fill(color.gradient)
                Text(profile.name.prefix(1).uppercased())
                    .font(.system(size: size * 0.42, weight: .heavy))
                    .foregroundStyle(.white)
                if let url = profile.avatarImageURL {
                    AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear }
                }
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.16))
            .hoverEffect(.highlight)
            HStack(spacing: 10) {
                Text(profile.name).font(.headline)
                if profile.isKids { Badge(text: "Kids") }
            }
        }
    }
}
