FROM node:20-alpine
# The image already ships a non-root "node" user with uid/gid 1000.
COPY --chmod=0555 run.sh /runner/run.sh
USER 1000:1000
WORKDIR /tmp
ENTRYPOINT []
CMD ["/runner/run.sh"]
