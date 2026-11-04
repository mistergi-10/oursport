import { createContext } from "react";
import type { Auth, Profile } from "../lib/types";

export const ProfileContext = createContext<Profile | null>(null);
export const AuthActionsContext = createContext<{ logout: () => void; updateProfile: (profile: Profile) => void }>({
  logout: () => undefined,
  updateProfile: () => undefined,
});
export const AuthContext = createContext<Auth>({});
