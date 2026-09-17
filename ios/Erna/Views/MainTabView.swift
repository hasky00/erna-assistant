import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            ChatView()
                .tabItem { Label("Chat", systemImage: "bubble.left.and.text.bubble.right") }

            TasksView()
                .tabItem { Label("Tasks", systemImage: "checklist") }

            NotesView()
                .tabItem { Label("Notes", systemImage: "note.text") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
