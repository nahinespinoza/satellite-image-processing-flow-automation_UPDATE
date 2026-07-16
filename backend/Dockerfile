FROM ubuntu:22.04

# Instalar dependencias
RUN apt update && apt install -y wget openjdk-17-jdk python3 python3-pip

# Instalar SNAP 10.0
WORKDIR /opt
RUN wget https://download.esa.int/step/snap/13.0/installers/esa-snap_sentinel_linux-13.0.0.sh && \
    chmod +x esa-snap_sentinel_linux-13.0.0.sh && \
    ./esa-snap_sentinel_linux-13.0.0.sh -q -dir /opt/snap

# Configurar PATH para GPT
ENV PATH="/opt/snap/bin:${PATH}"

# Copiar tu backend
WORKDIR /app
COPY . /app
RUN pip install flask flask-cors

# Exponer el puerto del backend
EXPOSE 8080

CMD ["python3", "controller.py"]
