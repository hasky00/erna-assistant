import Foundation

/// Build-time configuration, injected from `Config/Secrets.xcconfig` into
/// Info.plist. Nothing secret lives here: the Supabase publishable key is the
/// same value the web bundle already ships, and row level security is what
/// actually protects data. The OpenAI key stays server-side in the Next.js app.
enum Config {
    static let apiBaseURL = url(for: "ERNA_API_BASE_URL")
    static let supabaseURL = url(for: "ERNA_SUPABASE_URL")
    static let supabaseAnonKey = string(for: "ERNA_SUPABASE_ANON_KEY")

    private static func string(for key: String) -> String {
        let value = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""

        // An unsubstituted `$(VAR)` means Secrets.xcconfig is missing the key.
        guard !value.isEmpty, !value.hasPrefix("$(") else {
            fatalError(
                """
                Missing \(key).

                Copy ios/Config/Secrets.example.xcconfig to \
                ios/Config/Secrets.xcconfig and fill in your values, then \
                re-run `xcodegen generate` in ios/.
                """
            )
        }
        return value
    }

    private static func url(for key: String) -> URL {
        let raw = string(for: key)
        guard let url = URL(string: raw), url.scheme != nil, url.host != nil else {
            fatalError("\(key) is not a valid absolute URL: \(raw)")
        }
        return url
    }
}
