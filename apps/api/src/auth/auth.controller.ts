import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { authSessionSchema, type AuthSessionView, userSummarySchema, type UserSummary } from '@manara/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionCookieOptions } from '../http/cookie-options.js';
import { RequestContextService } from '../http/request-context.js';
import { ValidateBody } from '../http/validate.decorators.js';
import { CredentialVerificationService } from '../identity/application/credential-verification.service.js';
import { SessionService } from '../identity/application/session.service.js';
import { InvalidCredentialsError } from '../identity/domain/errors.js';
import type { AuthSession, User } from '../identity/domain/types.js';
import {
  LOGIN_RESPONSE_OPENAPI,
  SESSION_RESPONSE_OPENAPI,
  loginBodySchema,
  loginResponseSchema,
  sessionResponseSchema,
  type LoginBody,
  type LoginResponse,
  type SessionResponse,
} from './auth.dto.js';
import { SESSION_COOKIE } from './auth.tokens.js';

function toSessionView(session: AuthSession): AuthSessionView {
  return authSessionSchema.parse({
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
  });
}

function toUserSummary(user: User): UserSummary {
  return userSummarySchema.parse({
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });
}

/**
 * Thin HTTP layer over the identity application services. All business rules
 * live in `IdentityModule`; this controller only maps requests/responses,
 * manages the session cookie, and translates domain errors to HTTP errors.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(SESSION_COOKIE) private readonly sessionCookie: SessionCookieOptions,
    @Inject(CredentialVerificationService) private readonly credentials: CredentialVerificationService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService,
  ) {}

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(this.sessionCookie.name, token, this.sessionCookie.options);
  }

  private clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(this.sessionCookie.name, this.sessionCookie.options);
  }

  private sessionToken(request: FastifyRequest): string | null {
    const token = request.cookies[this.sessionCookie.name];
    return typeof token === 'string' && token !== '' ? token : null;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ValidateBody(loginBodySchema)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiOkResponse({ description: 'Authenticated; session cookie set', schema: LOGIN_RESPONSE_OPENAPI })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) reply: FastifyReply): Promise<LoginResponse> {
    let user: User;
    try {
      user = await this.credentials.authenticate(body.email, body.password);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException('Invalid credentials');
      }
      throw error;
    }
    const created = await this.sessions.createSession(user.id);
    this.setSessionCookie(reply, created.token);
    this.requestContext.update({ authenticatedUserId: user.id });
    return loginResponseSchema.parse({ session: toSessionView(created.session), user: toUserSummary(user) });
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session and clear the session cookie' })
  @ApiNoContentResponse({ description: 'Session revoked' })
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const token = this.sessionToken(request);
    if (token !== null) {
      await this.sessions.revokeSession(token);
    }
    this.clearSessionCookie(reply);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the session and issue a new session cookie' })
  @ApiOkResponse({ description: 'Session rotated; new cookie set', schema: SESSION_RESPONSE_OPENAPI })
  @ApiUnauthorizedResponse({ description: 'Session is missing, invalid, or expired' })
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SessionResponse> {
    const token = this.sessionToken(request);
    const rotated = token === null ? null : await this.sessions.rotateSession(token);
    if (rotated === null) {
      throw new UnauthorizedException('Session is invalid or expired');
    }
    this.setSessionCookie(reply, rotated.token);
    this.requestContext.update({ authenticatedUserId: rotated.session.userId });
    return sessionResponseSchema.parse({ session: toSessionView(rotated.session) });
  }

  @Get('session')
  @ApiOperation({ summary: 'Return the current session' })
  @ApiOkResponse({ description: 'Current session', schema: SESSION_RESPONSE_OPENAPI })
  @ApiUnauthorizedResponse({ description: 'No active session' })
  async session(@Req() request: FastifyRequest): Promise<SessionResponse> {
    const token = this.sessionToken(request);
    const session = token === null ? null : await this.sessions.validateSession(token);
    if (session === null) {
      throw new UnauthorizedException('No active session');
    }
    this.requestContext.update({ authenticatedUserId: session.userId });
    return sessionResponseSchema.parse({ session: toSessionView(session) });
  }
}
