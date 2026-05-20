import { redirect } from "next/navigation";
import { getCurrentUser, getUsers } from "@/lib/store";
import { ManualLeadForm } from "../components/ManualLeadForm";

export default async function ManualLeadsPage() {
  const [currentUser, users] = await Promise.all([getCurrentUser(), getUsers()]);
  if (currentUser.role !== "admin") redirect("/sales");

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Manual Bliss & Birch lead</h1>
          <p className="subtle">Add Instagram DMs, architect enquiries, referral calls, and offline lighting/fan leads.</p>
        </div>
      </div>
      <ManualLeadForm users={users} />
    </>
  );
}
