# The pretend Microsoft for the bank-mail e2e (#657): see
# ../../server/cmd/e2e-mail. Built from the repo root:
#   docker build -f e2e/mail/Dockerfile -t cloudbank-e2e-mail .
FROM golang:1.27-trixie AS build
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -o /out/e2e-mail ./cmd/e2e-mail

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/e2e-mail /e2e-mail
ENTRYPOINT ["/e2e-mail"]
