import SwiftUI

/// Brand colours.
///
/// The golds and the background come from the Erna mark
/// (`Design/erna-icon-gold-E.svg`); the neutral greys still mirror the CSS
/// custom properties in `app/globals.css` so the phone and the web app read as
/// the same product.
extension Color {
    static let ernaGold = Color(hex: 0xD4AF37)
    static let ernaGoldLight = Color(hex: 0xF6E27A)
    static let ernaGoldDark = Color(hex: 0x8C6A14)
    static let ernaBackground = Color(hex: 0x0A0A0A)
}

enum Theme {
    static let background = Color.ernaBackground
    static let foreground = Color(hex: 0xF6F7FB)
    static let muted = Color(hex: 0x9AA4B2)
    static let panel = Color(hex: 0x151B23)
    static let panelStrong = Color(hex: 0x1D2430)
    static let border = Color(hex: 0x2B3544)
    static let accent = Color.ernaGold
    static let accentStrong = Color.ernaGoldLight
    /// Used for the disabled state of accent-filled controls.
    static let accentMuted = Color.ernaGoldDark
    static let danger = Color(hex: 0xFF6B6B)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// Bordered panel used for cards and rows throughout the app.
struct PanelBackground: ViewModifier {
    var strong = false

    func body(content: Content) -> some View {
        content
            .background(strong ? Theme.panelStrong : Theme.panel)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

extension View {
    func panel(strong: Bool = false) -> some View {
        modifier(PanelBackground(strong: strong))
    }
}

/// Inline error banner. Failures are shown in place rather than as alerts so a
/// retry is always one tap away.
struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.danger)

            Text(message)
                .font(.footnote)
                .foregroundStyle(Theme.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let retry {
                Button("Retry", action: retry)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.accent)
            }
        }
        .padding(12)
        .background(Theme.danger.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Theme.danger.opacity(0.35), lineWidth: 1)
        )
    }
}
