import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/chat");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <AuthForm />
    </main>
  );
}
