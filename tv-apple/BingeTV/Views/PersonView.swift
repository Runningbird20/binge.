import SwiftUI

// The title page's Cast row: director or creators first, then the cast,
// each photo opening that person's page.
struct CastRow: View {
    let people: [CreditPerson]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: "Cast")
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 40) {
                    ForEach(people) { person in
                        VStack(spacing: 12) {
                            NavigationLink(value: PersonRef(id: person.id, name: person.name)) {
                                PersonPhoto(url: person.photo, name: person.name)
                                    .frame(width: 170, height: 170)
                            }
                            .buttonStyle(FocusCardStyle(cornerRadius: 85))
                            .accessibilityLabel([person.name, person.role].filter { !$0.isEmpty }.joined(separator: ", "))
                            VStack(spacing: 4) {
                                Text(person.name).font(.caption.weight(.semibold)).lineLimit(1)
                                if !person.role.isEmpty {
                                    Text(person.role).font(.caption2).foregroundStyle(Theme.muted).lineLimit(1)
                                }
                            }
                            .frame(width: 200)
                            .multilineTextAlignment(.center)
                            .accessibilityHidden(true)
                        }
                    }
                }
                .padding(.vertical, 30)
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
        .focusSection()
    }
}

struct PersonPhoto: View {
    let url: URL?
    let name: String

    var body: some View {
        RemoteImage(url: url) { image in
            image.resizable().aspectRatio(contentMode: .fill)
        } placeholder: {
            ZStack {
                Theme.raised
                Text(initials).font(.title2.weight(.bold)).foregroundStyle(Theme.muted)
            }
        }
    }

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined()
    }
}

// An actor's or director's page: photo, life line and bio, then their work
// on binge. as rows (the website's /person/:id).
struct PersonView: View {
    @EnvironmentObject private var app: AppModel
    let person: PersonRef
    @State private var page: PersonPage?
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 40) {
                HStack(alignment: .top, spacing: 60) {
                    PersonPhoto(url: page?.photo, name: person.name)
                        .frame(width: 300, height: 450)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    VStack(alignment: .leading, spacing: 18) {
                        Text(person.name)
                            .font(.system(size: 64, weight: .heavy))
                            .lineLimit(2)
                            .minimumScaleFactor(0.6)
                        if let line = [page?.department, page?.lifeLine].compactMap({ $0 }).joined(separator: "  ·  ").nilIfEmpty {
                            Text(line).font(.callout.weight(.semibold)).foregroundStyle(Theme.muted)
                        }
                        if let bio = page?.biography, !bio.isEmpty {
                            // Focusable so a long bio can be read whole.
                            BioText(text: bio)
                        }
                    }
                    .frame(maxWidth: 1100, alignment: .leading)
                }
                .focusSection()

                if let page {
                    if page.rows.isEmpty {
                        Text("Nothing with \(person.name) is on binge. yet.")
                            .font(.headline).foregroundStyle(Theme.muted)
                    }
                    ForEach(page.rows) { TitleRowView(row: $0) }
                } else if failed {
                    ProblemView(message: "Couldn't load \(person.name)'s page right now.") { Task { await load() } }
                } else {
                    ForEach(0..<2, id: \.self) { _ in RowSkeleton() }
                }
            }
            .padding(.vertical, 40)
        }
        .scrollClipDisabled()
        .task { await load() }
    }

    private func load() async {
        failed = false
        page = await People.load(person.id, maturity: app.maturity)
        failed = page == nil
    }
}

// The first lines of a biography; select it to read the rest.
private struct BioText: View {
    let text: String
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            Text(text)
                .font(.callout)
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(6)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
        }
        .buttonStyle(FocusCardStyle(cornerRadius: 16))
        .sheet(isPresented: $open) {
            ScrollView {
                Text(text).font(.body).padding(60).frame(maxWidth: 1400)
            }
        }
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
