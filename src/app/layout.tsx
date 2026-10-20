import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Cursor Maze",
  description:
    "Un labyrinthe procédural où le personnage est le curseur de la souris. Évitez les ennemis, gardez vos cœurs, trouvez la sortie.",
};

export const viewport: Viewport = {
  themeColor: "#07090e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
