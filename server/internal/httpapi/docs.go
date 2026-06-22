package httpapi

import (
	_ "embed"
	"net/http"
)

// openapiSpec is the API contract, embedded so the server can publish it and an
// interactive docs page without any external file. It is kept in sync with
// /api/openapi.yaml by a CI check.
//
//go:embed openapi.yaml
var openapiSpec []byte

// swaggerUIPage renders Swagger UI for the embedded spec. The UI assets are
// loaded from a pinned CDN; the spec itself is served locally from this binary,
// so the API surface is always documented even offline (only the rendering
// chrome needs the network).
const swaggerUIPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CloudBank API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
      });
    };
  </script>
</body>
</html>`

func serveOpenAPISpec(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	_, _ = w.Write(openapiSpec)
}

func serveSwaggerUI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(swaggerUIPage))
}
