import { redirect } from "next/navigation";

export default function LegacyCustomerMenuPage() {
  redirect("/customer/profile");
}
