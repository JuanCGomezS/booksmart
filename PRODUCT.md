# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Clients who need to book appointments with a service business.
- Staff who manage their assigned appointments.
- Business owners and administrators who operate their appointment-based business.

## Product Purpose

BookSmart is a platform for appointment-based businesses. It supports public booking and business operations for barbershops, beauty salons, nail studios, dental clinics, and similar services.

## Positioning

Open decision: the durable differentiator relative to other appointment platforms has not yet been confirmed.

## Operating Context

- A public business page is available at `/b/<slug>` for customer bookings.
- Businesses manage schedules, services, catalog, products, and team members.
- Super administrators manage businesses, plans, and access.

## Capabilities and Constraints

- The product uses the platform term `business`; each business declares its service category.
- Existing Firestore collections, fields, roles, and public routes preserve backwards compatibility with live data.
- The application is a web product built with Astro, React, Tailwind CSS, Firebase Authentication, and Firestore.

## Evidence on Hand

- `README.md` documents the platform scope, routes, capabilities, and deployment constraints.
- No verified testimonials, customer logos, pricing claims, or production metrics are available for design use.

## Product Principles

- Serve the booking journey and business operation without privileging only one user role.
- Preserve compatibility with existing business data and permissions.
- Support multiple appointment-based business categories with shared platform terminology.
- Do not fabricate commercial proof, pricing, or contact credentials.
