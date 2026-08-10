FROM golang:1.25-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /out/tk-delivery ./backend/cmd/app

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=build /out/tk-delivery /app/tk-delivery
COPY backend/migrations /app/backend/migrations
EXPOSE 8080
CMD ["/app/tk-delivery"]
