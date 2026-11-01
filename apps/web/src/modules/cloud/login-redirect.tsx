import { useEffect, useRef, useState } from "react";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { browserCloudConfig } from "./config";

// WorkOS Initiate login URI: starts AuthKit sign-in without a click (invitations, password resets).
export default function LoginRedirect() {
  const [configuration] = useState(browserCloudConfig);
  if (!configuration)
    return <p>Cloud sign-in is not configured for this app. You can keep editing locally.</p>;
  return (
    <AuthKitProvider
      clientId={configuration.clientId}
      redirectUri={configuration.redirectUri}
      devMode={configuration.devMode}
      {...(configuration.apiHostname ? { apiHostname: configuration.apiHostname } : {})}
    >
      <StartSignIn />
    </AuthKitProvider>
  );
}

function StartSignIn() {
  const { isLoading, user, signIn } = useAuth();
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (isLoading || started.current) return;
    started.current = true;
    if (user) {
      window.location.replace("/");
      return;
    }
    void signIn().catch(() => setError("Sign-in could not start. Reload to try again."));
  }, [isLoading, user, signIn]);
  return error ? <p role="alert">{error}</p> : <p role="status">Redirecting to sign in…</p>;
}
