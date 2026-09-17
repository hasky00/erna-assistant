import SwiftUI

struct LoginView: View {
    @Environment(AppServices.self) private var services

    @State private var email = ""
    @State private var password = ""
    @State private var isCreatingAccount = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var notice: String?

    @FocusState private var focused: Field?
    private enum Field { case email, password }

    private var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty
            && password.count >= 6
            && !isSubmitting
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                header

                VStack(spacing: 12) {
                    field("Email", text: $email, field: .email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    field("Password", text: $password, field: .password, secure: true)
                        .textContentType(isCreatingAccount ? .newPassword : .password)
                }

                if let notice {
                    Text(notice)
                        .font(.footnote)
                        .foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let errorMessage {
                    ErrorBanner(message: errorMessage)
                }

                submitButton

                Button(isCreatingAccount ? "I already have an account" : "Create an account") {
                    withAnimation {
                        isCreatingAccount.toggle()
                        errorMessage = nil
                        notice = nil
                    }
                }
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.muted)
            }
            .padding(24)
            .frame(maxWidth: 420)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background)
    }

    private var header: some View {
        VStack(spacing: 8) {
            Image(.ernaLogo)
                .resizable()
                .scaledToFit()
                .frame(width: 120, height: 120)
                .accessibilityHidden(true)

            Text("Erna")
                .font(.system(size: 40, weight: .bold, design: .serif))
                .foregroundStyle(Theme.accent)

            Text("Your private assistant — memory, tasks, and notes.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 32)
        .padding(.bottom, 8)
    }

    private func field(
        _ label: String,
        text: Binding<String>,
        field: Field,
        secure: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.muted)

            Group {
                if secure {
                    SecureField("", text: text)
                } else {
                    TextField("", text: text)
                }
            }
            .focused($focused, equals: field)
            .submitLabel(secure ? .go : .next)
            .onSubmit {
                if secure {
                    Task { await submit() }
                } else {
                    focused = .password
                }
            }
            .padding(12)
            .foregroundStyle(Theme.foreground)
            .panel(strong: true)
        }
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack {
                if isSubmitting {
                    ProgressView().tint(Theme.background)
                }
                Text(isCreatingAccount ? "Create account" : "Sign in")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(canSubmit ? Theme.accent : Theme.accentMuted)
            .foregroundStyle(Theme.background)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .disabled(!canSubmit)
    }

    private func submit() async {
        guard canSubmit else { return }

        isSubmitting = true
        errorMessage = nil
        notice = nil
        defer { isSubmitting = false }

        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)

        do {
            if isCreatingAccount {
                try await services.auth.signUp(email: trimmedEmail, password: password)
            } else {
                try await services.auth.signIn(email: trimmedEmail, password: password)
            }
        } catch AuthError.needsEmailConfirmation {
            // Not a failure: the account exists, it just needs confirming.
            isCreatingAccount = false
            notice = AuthError.needsEmailConfirmation.localizedDescription
            password = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
