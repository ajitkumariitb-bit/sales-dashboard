import { redirect } from "next/navigation";
import { getCurrentUser, getUsers } from "@/lib/store";
import { UserCreateForm } from "../components/UserCreateForm";

export default async function UsersPage() {
  const [currentUser, users] = await Promise.all([getCurrentUser(), getUsers()]);
  if (currentUser.role !== "admin") redirect("/sales");

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Users</h1>
          <p className="subtle">Create admin and salesperson logins. Salespeople only see assigned leads.</p>
        </div>
      </div>
      <UserCreateForm />
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Existing users</h2>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.name}</strong></td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{new Date(user.created_at).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
