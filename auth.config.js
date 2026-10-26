// Edge-safe Auth.js configuration. This file must NOT import Prisma, bcrypt,
// or any Node-only module, because it is loaded by the Edge middleware.
// The Credentials provider (which needs the database) is added in ./auth.js.

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/papers",
  "/submissions",
  "/submit",
  "/activity",
  "/users",
  "/volumes",
  "/archive",
  "/import",
];

/** @type {import('next-auth').NextAuthConfig} */
const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [], // real providers are declared in ./auth.js (Node runtime)
  callbacks: {
    // Gate the authenticated (app) route group. Returning false redirects to signIn.
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isProtected = PROTECTED_PREFIXES.some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      );
      if (!isProtected) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.isAdmin = !!user.isAdmin;
        token.baseType = user.baseType ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid;
        session.user.isAdmin = !!token.isAdmin;
        session.user.baseType = token.baseType ?? null;
      }
      return session;
    },
  },
};

export default authConfig;
