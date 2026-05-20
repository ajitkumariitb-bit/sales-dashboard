"use client";

import { useRouter } from "next/navigation";
import type { AppUser } from "@/lib/types";

export function RoleSwitcher({ users, currentUserId }: { users: AppUser[]; currentUserId: string }) {
  const router = useRouter();

  async function onChange(userId: string) {
    await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId })
    });
    router.refresh();
  }

  return (
    <div className="user-box">
      <label htmlFor="user-switch">Demo login</label>
      <select id="user-switch" defaultValue={currentUserId} onChange={(event) => onChange(event.target.value)}>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} ({user.role})
          </option>
        ))}
      </select>
    </div>
  );
}
