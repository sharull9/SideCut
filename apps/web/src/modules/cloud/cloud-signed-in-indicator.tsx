import { useAuth } from "@workos-inc/authkit-react";

// Loaded only when cloud is configured, so useAuth always has an AuthKitProvider above it.
// Kept in its own module so AuthKit stays out of the editor's entry bundle.
export default function CloudSignedInIndicator() {
  const { user, isLoading } = useAuth();
  if (isLoading || !user) return null;
  return (
    <>
      <span aria-hidden="true" className="ml-1.5 size-1.5 rounded-full bg-primary" />
      <span className="sr-only">(signed in as {user.email})</span>
    </>
  );
}
