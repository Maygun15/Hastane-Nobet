import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("UI error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen grid place-items-center bg-rose-50">
          <div className="max-w-xl p-6 bg-white rounded-2xl shadow">
            <div className="text-lg font-semibold mb-2">Bir hata oluştu</div>
            <pre className="text-xs whitespace-pre-wrap text-rose-700">
              {String(this.state.error)}
            </pre>
            <div className="text-xs text-slate-500 mt-2">
              Tarayıcı konsolundaki hatayı da kontrol edebilirsin.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
