#!/bin/sh
if [ "$RENEWED_LINEAGE" = "/etc/letsencrypt/live/serverh.uhbacon.cloud" ]; then
    /usr/sbin/nginx -t && /bin/systemctl reload nginx
fi
