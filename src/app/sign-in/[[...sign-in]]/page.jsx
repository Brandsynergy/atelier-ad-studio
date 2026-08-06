import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#f8f6f3",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28, letterSpacing: 6, color: "#1a1a1a", margin: 0 }}>
          ATELIER<span style={{ color: "#c9a96e" }}>.</span>
        </h1>
        <p style={{ color: "#888", fontSize: 13, marginTop: 6, letterSpacing: 1 }}>
          AI Casting &amp; Campaign Studio
        </p>
      </div>
      <SignIn />
    </div>
  );
}
