FROM php:8.2-apache

# Extensions PHP requises par GestSup
RUN apt-get update && apt-get install -y --no-install-recommends \
      libicu-dev libpng-dev libjpeg-dev libfreetype6-dev libzip-dev libonig-dev \
      openssl ca-certificates \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql mysqli gd intl zip mbstring \
    && rm -rf /var/lib/apt/lists/*

# Apache : SSL (l'API GestSup exige le port 443) + rewrite (routage /api/v1)
RUN a2enmod ssl rewrite headers && a2ensite default-ssl

# Certificat auto-signé pour le HTTPS local
RUN openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
      -keyout /etc/ssl/private/ssl-cert-snakeoil.key \
      -out /etc/ssl/certs/ssl-cert-snakeoil.pem \
      -subj "/CN=localhost"

COPY gestsup.conf /etc/apache2/conf-enabled/gestsup.conf

# Code source GestSup (populé par ../fetch-source.sh) + connexion DB pré-remplie
COPY src/ /var/www/html/
COPY connect.php /var/www/html/connect.php

RUN chown -R www-data:www-data /var/www/html

EXPOSE 80 443
