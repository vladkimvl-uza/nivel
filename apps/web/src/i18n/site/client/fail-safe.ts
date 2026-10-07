// A boundary for the parts of the page that are only decoration: when such a part fails (its chunk does not come, it throws while
// it draws), the visitor keeps the page and sees the fallback instead; without a boundary React would replace the whole page with
// the error screen of Next, and the price list and the form with it.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

export class FailSafe extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    // Only the name: the text of a failed import names addresses.
    console.error("site: a decorative part of the page failed, its fallback is shown", { error: error.name });
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
