// src/ErrorBoundary.jsx
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, err };
  }
  componentDidCatch(err, info) {
    // İstersen loglayabilirsin
    // console.error("ErrorBoundary", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 m-4 rounded-xl border bg-red-50 text-red-800">
          <div className="font-semibold mb-1">Bir şeyler ters gitti.</div>
          <div className="text-sm opacity-80">
            {String(this.state.err?.message || this.state.err || "Bilinmeyen hata")}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
