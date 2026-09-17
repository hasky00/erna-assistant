import Foundation

/// Date handling for the two directions we talk in.
///
/// Reading: PostgREST renders `timestamptz` with up to six fractional digits
/// and a numeric offset (`2026-09-16T10:00:00.123456+00:00`), which
/// `ISO8601DateFormatter` rejects — it accepts at most three. We trim first.
///
/// Writing: the API validates `due_at` with Zod's `.datetime()`, which requires
/// UTC with a `Z` suffix and no numeric offset.
enum ISODate {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let outbound: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    static func parse(_ raw: String) -> Date? {
        let trimmed = trimFraction(raw)
        return fractional.date(from: trimmed) ?? plain.date(from: trimmed)
    }

    /// UTC, `Z`-suffixed — the only shape Zod's `.datetime()` accepts.
    static func string(from date: Date) -> String {
        outbound.string(from: date)
    }

    /// Cut sub-millisecond precision: `.123456+00:00` -> `.123+00:00`.
    private static func trimFraction(_ raw: String) -> String {
        guard let dot = raw.firstIndex(of: ".") else { return raw }

        var digitsEnd = raw.index(after: dot)
        while digitsEnd < raw.endIndex, raw[digitsEnd].isNumber {
            digitsEnd = raw.index(after: digitsEnd)
        }

        let digits = raw[raw.index(after: dot)..<digitsEnd]
        guard digits.count > 3 else { return raw }

        let keep = raw.index(dot, offsetBy: 4)
        return String(raw[..<keep]) + String(raw[digitsEnd...])
    }
}

extension JSONDecoder {
    static let erna: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            guard let date = ISODate.parse(raw) else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: decoder.codingPath, debugDescription: "Unrecognized date: \(raw)")
                )
            }
            return date
        }
        return decoder
    }()
}
