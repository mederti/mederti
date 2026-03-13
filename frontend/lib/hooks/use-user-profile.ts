"use client";

import { useState, useEffect } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export interface UserProfile {
  user_id: string;
  role: "pharmacist" | "hospital" | "supplier" | "government" | "default";
  company_name: string | null;
}

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await supabase
          .from("user_profiles")
          .select("user_id, role, company_name")
          .eq("user_id", session.user.id)
          .single();
        if (data) setProfile(data as UserProfile);
      } catch {
        // No profile row — profile stays null
      }
      setLoading(false);
    });
  }, []);

  return { profile, loading, isSupplier: profile?.role === "supplier" };
}
