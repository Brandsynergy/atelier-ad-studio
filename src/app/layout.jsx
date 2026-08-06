import { ClerkProvider } from "@clerk/nextjs";

export const metadata = {
  title: "ATELIER — AI Advertising Studio",
  description:
    "Cast photoreal AI talent and produce full campaign packs — hero, social, story — in minutes.",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
