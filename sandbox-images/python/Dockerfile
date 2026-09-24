FROM python:3.12-alpine
RUN adduser -D -u 1000 runner
COPY --chmod=0555 run.sh /runner/run.sh
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 1000:1000
WORKDIR /tmp
ENTRYPOINT []
CMD ["/runner/run.sh"]
