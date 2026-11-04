import { redirect } from "next/navigation";

/** Setup now happens as a wizard on the dashboard. Old links land there. */
export default function OnboardingRedirect() {
  redirect("/dashboard");
}
