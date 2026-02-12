// ============================================================================
// LoginForm Component — LoginForm.js
// ============================================================================
// Full-screen login page for connecting to a Nextcloud/CalDAV server.
// Collects server URL, username, password, and optional "Remember Me".
// Displays a gradient background with the Kalendar branding.
// On submit, delegates to the parent's onSubmit handler which triggers
// the CalDAV connection flow via IPC.
// ============================================================================

class LoginForm extends React.Component {
  render() {
    const {
      serverUrl,
      username,
      password,
      onInputChange,
      onSubmit,
      isLoading,
      errorMessage,
    } = this.props;

    return h(
      "div",
      { className: "login-container" },
      h(
        "div",
        { className: "login-form" },
        h(
          "div",
          { className: "app-logo" },
          h(
            "h1",
            { className: "app-title" },
            h("span", { className: "logo-icon" }, "."),
            "Kalendar"
          ),
          h(
            "p",
            { className: "app-subtitle" },
            "Your personal Nextcloud calendar companion"
          )
        ),

        // Error Message
        errorMessage &&
          h(
            "div",
            { className: "error-message" },
            h("span", { className: "error-icon" }, "⚠️"),
            errorMessage
          ),

        h(
          "form",
          { onSubmit: onSubmit },
          h(
            "div",
            { className: "form-group" },
            h("label", null, "Nextcloud Server URL"),
            h("input", {
              type: "text",
              name: "serverUrl",
              value: serverUrl,
              onChange: onInputChange,
              placeholder: "https://cloud.example.com",
              required: true,
              autoFocus: true,
              disabled: isLoading,
            }),
            h(
              "small",
              { className: "form-help" },
              "CalDAV path will be added automatically"
            )
          ),
          h(
            "div",
            { className: "form-group" },
            h("label", null, "Username"),
            h("input", {
              type: "text",
              name: "username",
              value: username,
              onChange: onInputChange,
              placeholder: "your-username",
              required: true,
              disabled: isLoading,
            })
          ),
          h(
            "div",
            { className: "form-group" },
            h("label", null, "Password / App Password"),
            h("input", {
              type: "password",
              name: "password",
              value: password,
              onChange: onInputChange,
              placeholder: "••••••••••••",
              required: true,
              disabled: isLoading,
            }),
            h(
              "small",
              { className: "form-help" },
              "We recommend using an app-specific password"
            )
          ),
          h(
            "button",
            {
              type: "submit",
              className: "btn-primary btn-large",
              disabled: isLoading,
            },
            isLoading ? "Connecting..." : "Connect to Nextcloud"
          )
        )
      )
    );
  }
}

window.LoginForm = LoginForm;
