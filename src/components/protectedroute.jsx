import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import PageSpinner from "./PageSpinner";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageSpinner fullScreen label="Loading..." />;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return children;
}
