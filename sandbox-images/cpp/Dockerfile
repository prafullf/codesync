FROM gcc:13
RUN useradd -u 1000 -M -d /tmp runner
COPY --chmod=0555 run.sh /runner/run.sh
USER 1000:1000
WORKDIR /tmp
ENTRYPOINT []
CMD ["/runner/run.sh"]
