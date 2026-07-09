import toast from "react-hot-toast";

export function showError(msg: string) {
  console.error("[ERROR]", msg);
  toast.error(msg, { duration: 4000, position: "top-center" });
}

export function showSuccess(msg: string) {
  console.log("[OK]", msg);
  toast.success(msg, { duration: 2500, position: "top-center" });
}

export function showInfo(msg: string) {
  console.info("[INFO]", msg);
  toast(msg, { duration: 3000, position: "top-center", icon: "ℹ️" });
}
