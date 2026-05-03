FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        proftpd-basic \
        proftpd-mod-crypto \
        openssl && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/false ftpuser && \
    echo "ftpuser:ftppassword" | chpasswd

RUN mkdir -p /etc/proftpd/ssl && \
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout /etc/proftpd/ssl/server.key \
        -out /etc/proftpd/ssl/server.crt \
        -subj "/CN=localhost" && \
    chmod 600 /etc/proftpd/ssl/server.key

COPY proftpd.conf /etc/proftpd/proftpd.conf

EXPOSE 21 30000-30009

# Probe only the control port; passive ports are opened on-demand per transfer.
HEALTHCHECK --interval=1s --timeout=3s --start-period=10s --retries=15 \
    CMD bash -c 'cat < /dev/null > /dev/tcp/localhost/21' || exit 1

CMD ["proftpd", "--nodaemon"]
